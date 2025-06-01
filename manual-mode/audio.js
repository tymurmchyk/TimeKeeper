import { success, failure } from "../common/result.js";
import { IntervalClicker } from "../common/clicker.js";

import { state } from "./state.js";

if (typeof browser === "undefined") {
    var browser = chrome;
}

/** @type {AudioContext} */
let context = null;
/** @type {IntervalClicker} */
let clicker = null;
/** @type {GainNode} */
let clickGain = null;

function getClickTypes(timeSignature) {
    const [numerator] = timeSignature.split('/').map(Number);
    
    switch (timeSignature) {
        case "2/4":
            return [
                { type: "square", frequency: 880, beats: [1] },
                { type: "square", frequency: 440, beats: [2] }
            ];
        case "3/4":
            return [
                { type: "square", frequency: 880, beats: [1] },
                { type: "square", frequency: 440, beats: [2, 3] }
            ];
        case "4/4":
            return [
                { type: "square", frequency: 880, beats: [1] },
                { type: "square", frequency: 440, beats: [2, 3, 4] }
            ];
        case "5/4":
            return [
                { type: "square", frequency: 880, beats: [1] },
                { type: "square", frequency: 440, beats: [2, 3, 4, 5] }
            ];
        case "6/8":
            return [
                { type: "square", frequency: 880, beats: [1] },
                { type: "square", frequency: 660, beats: [4] },
                { type: "square", frequency: 440, beats: [2, 3, 5, 6] }
            ];
        case "9/8":
            return [
                { type: "square", frequency: 880, beats: [1] },
                { type: "square", frequency: 440, beats: [4, 7] },
                { type: "square", frequency: 330, beats: [2, 3, 5, 6, 8, 9] }
            ];
        case "12/8":
            return [
                { type: "square", frequency: 880, beats: [1] },
                { type: "square", frequency: 440, beats: [4, 7, 10] },
                { type: "square", frequency: 330, beats: [2, 3, 5, 6, 8, 9, 11, 12] }
            ];
        default:
            return [
                { type: "square", frequency: 880, beats: [1] },
                { type: "square", frequency: 440, beats: Array.from({ length: numerator - 1 }, (_, i) => i + 2) }
            ];
    }
}

export function isSetup() { return !!context; }

export function setup() {
    if (isSetup()) {
		return success();
	}

    context = new AudioContext();
    clickGain = new GainNode(context, { gain: state.clickVolume });
    clickGain.connect(context.destination);

    return success();
}

export function start() {
    if (!isSetup()) {
        return failure({ description: "Audio context is not ready" });
    }

    if (clicker) { clicker.close(); }
    clicker = new IntervalClicker(context, {
        clicks: getClickTypes(state.timeSignature)
    });
    clicker.connect(clickGain);
    clicker.start(0, { time: state.bpm, type: "bpm" });

    return success();
}

export function pause() {
    if (!isSetup()) {
        return failure({ description: "Audio context is not ready" });
    }

    if (clicker) {
        clicker.pause();
    }

    return success();
}

export function close() {
    if (!isSetup()) {
        return success();
    }

    context.close();
    context = null;
    clicker?.close();
    clicker = null;
    clickGain = null;

    return success();
}

export function setVolume(value) {
    if (typeof value !== "number" || value < 0 || value > 1) {
        return failure({
            description: "Volume must be a number in range [0; 1]"
        });
    }

    state.clickVolume = value;
    if (isSetup()) {
        clickGain.gain.value = value;
    }

    return success();
}

export function setBPM(value) {
    if (typeof value !== "number" || value < 15 || value > 500) {
        return failure({
            description: "BPM must be a number in range [15; 500]"
        });
    }

    state.bpm = value;
    if (state.playing && clicker) {
        clicker.start(0, { time: value, type: "bpm" });
    }

    return success();
}

export function setTimeSignature(value) {
    const validSignatures = ["2/4", "3/4", "4/4", "5/4", "6/8", "9/8", "12/8"];
    if (!validSignatures.includes(value)) {
        return failure({
            description: "Time signature must be one of: " + validSignatures.join(", ")
        });
    }

    state.timeSignature = value;
    if (state.playing && clicker) {
        clicker.close();
        clicker = new IntervalClicker(context, {
            clicks: getClickTypes(value)
        });
        clicker.connect(clickGain);
        clicker.start(0, { time: state.bpm, type: "bpm" });
    }

    return success();
}

export function getCurrentBeat() {
    if (!clicker) return null;
    return clicker.getCurrentBeat();
} 