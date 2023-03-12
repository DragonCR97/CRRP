import * as alt from 'alt-client';
import * as native from 'natives';

import { AthenaClient } from '@AthenaClient/api/athena';
import { drawMarkerSimple } from '@AthenaClient/utility/marker';
import { MARKER_TYPE } from '@AthenaShared/enums/markerTypes';
import { SYSTEM_EVENTS } from '@AthenaShared/enums/system';
import { handleFrontendSound } from './sound';
import { NpcWheelMenu } from '@AthenaClient/menus/npc';
import { PlayerWheelMenu } from '@AthenaClient/menus/player';
import { VehicleWheelMenu } from '@AthenaClient/menus/vehicle';
import { ClientItemDrops } from '@AthenaClient/streamers/item';
import { Interaction } from '@AthenaShared/interfaces/interaction';
import { ClientInteraction } from './interaction';
import { KEY_BINDS } from '@AthenaShared/enums/keyBinds';
import { ObjectWheelMenu } from '@AthenaClient/menus/object';
import { getObjectFromScriptID } from '@AthenaClient/streamers/object';

type ValidEntityTypes = 'object' | 'pos' | 'npc' | 'player' | 'vehicle' | 'interaction';
type TargetInfo = { id: number; pos: alt.IVector3; type: ValidEntityTypes; dist: number; height: number };

let MAX_TARGETS = 50;
let everyTick: number;
let selections: Array<TargetInfo> = [];
let selectionIndex = 0;
let lastSelection: TargetInfo;
let nextUpdate = Date.now();
let timeBetweenUpdates = 5000;
let showMarker = true;
let color: alt.RGBA = new alt.RGBA(255, 255, 255, 200);
let size = new alt.Vector3(0.1, 0.05, 0.1);
let latestInteraction: Interaction;

const Internal = {
    init() {
        everyTick = alt.everyTick(Internal.tick);

        AthenaClient.hotkeys.add({
            key: KEY_BINDS.INTERACT,
            description: 'Interact',
            identifier: 'interact-hotkey',
            modifier: 'shift',
            keyDown: Internal.invokeSelection,
        });

        AthenaClient.hotkeys.add({
            key: KEY_BINDS.INTERACT_ALT,
            description: 'Interact Alternative',
            identifier: 'interact-hotkey-alt',
            keyDown: Internal.invokeSelection,
        });

        AthenaClient.hotkeys.add({
            key: KEY_BINDS.INTERACT_CYCLE,
            description: 'Interact Change Target',
            identifier: 'interact-hotkey-cycle',
            keyDown: Internal.selectClosestEntity,
        });

        selectionIndex = 0;
        Internal.updateSelectionList();
    },
    convert(dataSet: Array<alt.Entity>, type: ValidEntityTypes): Array<TargetInfo> {
        let entityInfo: Array<TargetInfo> = [];

        for (let i = 0; i < dataSet.length; i++) {
            if (type === 'player' && dataSet[i].id === alt.Player.local.scriptID) {
                continue;
            }

            const [_, min, max] = native.getModelDimensions(dataSet[i].model);
            const height = Math.abs(min.z) + Math.abs(max.z);
            const dist = AthenaClient.utility.distance2D(alt.Player.local.pos, dataSet[i].pos);
            entityInfo.push({ id: dataSet[i].scriptID, dist, type, pos: dataSet[i].pos, height });
        }

        return entityInfo;
    },
    updateSelectionList() {
        const players = [...alt.Player.streamedIn];
        const vehicles = [...alt.Vehicle.streamedIn];
        const objects = [...alt.Object.all];

        let entityInfo: Array<TargetInfo> = Internal.convert(players, 'player');
        entityInfo = entityInfo.concat(Internal.convert(vehicles, 'vehicle'));
        entityInfo = entityInfo.concat(Internal.convert(objects, 'object'));
        if (latestInteraction) {
            const dist = AthenaClient.utility.distance2D(alt.Player.local.pos, latestInteraction.position);
            entityInfo.push({ dist, height: 1, id: -1, pos: latestInteraction.position, type: 'interaction' });
        }

        entityInfo.sort((a, b) => {
            return a.dist - b.dist;
        });

        selections = entityInfo.slice(0, entityInfo.length < 5 ? entityInfo.length : MAX_TARGETS);

        if (typeof lastSelection === 'undefined') {
            if (selections.length >= 1) {
                lastSelection = selections[0];
                selectionIndex = 0;
            }

            return;
        }

        if (selections.length <= 0) {
            lastSelection = undefined;
            return;
        }

        let index = selections.findIndex((x) => x.id === lastSelection.id);
        if (index <= -1) {
            index = 0;
        }

        lastSelection = selections[index];
        selectionIndex = index;
    },
    selectClosestEntity() {
        if (AthenaClient.webview.isAnyMenuOpen()) {
            return;
        }

        if (typeof everyTick !== 'number') {
            return;
        }

        selectionIndex += 1;
        if (selectionIndex >= selections.length) {
            selectionIndex = 0;
        }

        lastSelection = selections[selectionIndex];
        handleFrontendSound('SKIP', 'HUD_FRONTEND_DEFAULT_SOUNDSET');
    },
    invokeSelection() {
        if (latestInteraction) {
            ClientInteraction.invoke();
            return;
        }

        const selection = selections[selectionIndex];
        if (typeof selection === 'undefined') {
            return;
        }

        switch (selection.type) {
            case 'npc':
                NpcWheelMenu.openMenu(selection.id);
                break;
            case 'player':
                const targetPlayer = alt.Player.all.find((x) => x.scriptID === selection.id);
                if (!targetPlayer || !targetPlayer.valid) {
                    break;
                }

                PlayerWheelMenu.openMenu(targetPlayer);
                break;
            case 'vehicle':
                const targetVehicle = alt.Vehicle.all.find((x) => x.scriptID === selection.id);
                if (!targetVehicle || !targetVehicle.valid) {
                    break;
                }

                VehicleWheelMenu.openMenu(targetVehicle);
                break;
            case 'object':
                const object = alt.Object.all.find((x) => x.scriptID === selection.id);
                if (typeof object === 'undefined') {
                    break;
                }

                const droppedItem = ClientItemDrops.getDroppedItem(object.scriptID);
                if (typeof droppedItem !== 'undefined') {
                    if (alt.Player.local.vehicle) {
                        return;
                    }

                    native.taskGoToCoordAnyMeans(
                        alt.Player.local.scriptID,
                        droppedItem.pos.x,
                        droppedItem.pos.y,
                        droppedItem.pos.z,
                        2,
                        0,
                        false,
                        786603,
                        0,
                    );

                    alt.emitServer(SYSTEM_EVENTS.INTERACTION_PICKUP_ITEM, droppedItem._id);
                    break;
                }

                const objectInstance = getObjectFromScriptID(selection.id);
                if (typeof objectInstance === 'undefined') {
                    break;
                }

                ObjectWheelMenu.openMenu(objectInstance);
                break;
            case 'pos':
                break;
            case 'interaction':
                ClientInteraction.invoke();
                break;
        }
    },
    tick() {
        if (AthenaClient.webview.isAnyMenuOpen()) {
            return;
        }

        if (Date.now() > nextUpdate) {
            nextUpdate = Date.now() + timeBetweenUpdates;
            selectionIndex = 0;
            Internal.updateSelectionList();
        }

        if (selections.length <= 0) {
            return;
        }

        const pos = new alt.Vector3(selections[selectionIndex].pos).add(
            0,
            0,
            isNaN(selections[selectionIndex].height) ? 1 : selections[selectionIndex].height,
        );

        if (!showMarker) {
            return;
        }

        if (alt.Player.local.vehicle && selections[selectionIndex].id === alt.Player.local.vehicle.scriptID) {
            drawMarkerSimple(
                MARKER_TYPE.CHEVRON_UP,
                alt.Player.local.vehicle.pos.add(0, 0, 2),
                new alt.Vector3(0, 180, 0),
                size,
                color,
                true,
            );
            return;
        }

        drawMarkerSimple(MARKER_TYPE.CHEVRON_UP, pos, new alt.Vector3(0, 180, 0), size, color, true);
    },
};

export const EntitySelector = {
    get: {
        /**
         * Return the currently selected entity.
         *
         * @return {(TargetInfo | undefined)}
         */
        selection(): TargetInfo | undefined {
            if (selections.length <= 0) {
                return undefined;
            }

            return selections[selectionIndex];
        },
        /**
         * Get all of the current entities in the player's radius.
         *
         * @return {Array<TargetInfo>}
         */
        selectables(): Array<TargetInfo> {
            return selections;
        },
    },
    set: {
        /**
         * Sets an interaction to be pushed into the entity list.
         *
         * @param {(Interaction | undefined)} interaction
         */
        interaction(interaction: Interaction | undefined) {
            latestInteraction = interaction;
        },
        /**
         * Turn the marker off.
         *
         */
        markerOff() {
            showMarker = false;
        },
        /**
         * Change the defualt marker colour.
         *
         * @param {alt.RGBA} customColor
         */
        markerColor(customColor: alt.RGBA) {
            color = customColor;
        },
        /**
         * Change the defualt marker size.
         *
         * @param {alt.Vector3} markerSize
         */
        markerSize(markerSize: alt.Vector3) {
            size = markerSize;
        },
    },
};

alt.onServer(SYSTEM_EVENTS.TICKS_START, Internal.init);
