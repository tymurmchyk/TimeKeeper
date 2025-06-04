import { sendMessage } from "../common/runtime-messaging.js";

let state = {
    /** @type {boolean} */
    playing: false,
    /** @type {number} */
    bpm: 120,
    /** @type {number} */
    clickVolume: 0.5,
    /** @type {string} */
    timeSignature: "4/4",
    /** @type {number} */
    tapCount: 0,
    /** @type {number} */
    requiredTaps: 4,
    /** @type {number | null} */
    currentBeat: null
};

const ui = {
    elements: {
        toggle: null,
        volumeClicker: null,
        bpm: null,
        timeSignature: null,
        tap: null
    },

    state: {
        updateInterval: null,
        isBpmFocused: false
    },

    update() {
        ui.elements.toggle.textContent = state.playing ? "⏸" : "▶";
        if (!ui.state.isBpmFocused) {
            ui.elements.bpm.value = state.bpm;
        }
        ui.elements.volumeClicker.value = state.clickVolume;
        ui.elements.timeSignature.value = state.timeSignature;

        if (state.playing && state.currentBeat !== null && state.tapCount === 0) {
            ui.elements.tap.textContent = state.currentBeat.toString();
        }
		else if (state.tapCount > 0) {
            ui.elements.tap.textContent = `tap (${state.tapCount}/${state.requiredTaps})`;
        }
		else {
            ui.elements.tap.textContent = "tap";
        }

        if (state.playing) {
            startStateUpdates();
        }
        else {
            stopStateUpdates();
        }
    },

    handlers: {
        async toggleClick() {
            const toggling = await sendMessage({
                type: ["manual-mode", "toggle"],
                data: { statePlaying: !state.playing }
            });
            if (!toggling || toggling.type === "failure") {
                console.error("Failed to toggle: " + (toggling ? (toggling?.description ?? "Unknown error") : "No response"));
                return;
            }

            await stateUpdate();
        },

        async volumeInput(event) {
            let newVolume = parseFloat(event.target.value);

            if (!newVolume || newVolume < 0.) { newVolume = 0.; }
            else if (newVolume > 1.) { newVolume = 1.; }

            const changing = await sendMessage({
                type: ["manual-mode", "change-volume"],
                data: { newVolume }
            });
            if (!changing || changing.type === "failure") {
                console.error("Failed to change volume: " + (changing ? (changing?.description ?? "Unknown error") : "No response"));
                return;
            }

            await stateUpdate();
        },

        async bpmChange(event) {
            let newBPM = parseInt(event.target.value);

            if (isNaN(newBPM) || newBPM < 15) { newBPM = 15; }
            else if (newBPM > 500) { newBPM = 500; }

            const changing = await sendMessage({
                type: ["manual-mode", "change-bpm"],
                data: { newBpm: newBPM }
            });
            if (!changing || changing.type === "failure") {
                console.error("Failed to change BPM: " + (changing ? (changing?.description ?? "Unknown error") : "No response"));
                return;
            }

            await stateUpdate();
        },

        async timeSignatureChange(event) {
            const timeSignature = event.target.value;

            const changing = await sendMessage({
                type: ["manual-mode", "change-time-signature"],
                data: { timeSignature }
            });
            if (!changing || changing.type === "failure") {
                console.error("Failed to change time signature: " + (changing ? (changing?.description ?? "Unknown error") : "No response"));
                return;
            }

            await stateUpdate();
        },

        async tapClick() {
            ui.elements.tap.classList.add("active");
            setTimeout(() => ui.elements.tap.classList.remove("active"), 100);

            const tapping = await sendMessage({
                type: ["manual-mode", "tap"]
            });
            if (!tapping || tapping.type === "failure") {
                console.error("Failed to process tap: " + (tapping ? (tapping?.description ?? "Unknown error") : "No response"));
                return;
            }

            await stateUpdate();
        },

        bpmFocus(event) {
            event.target.focus();
            ui.state.isBpmFocused = true;
        },

        bpmBlur() {
            ui.state.isBpmFocused = false;
            ui.elements.bpm.value = state.bpm;
        }
    }
};

async function stateUpdate() {
    const gettingState = await sendMessage({
        type: ["manual-mode", "get-state"]
    });
    if (!gettingState || gettingState.type === "failure") {
        console.error("Failed to update state: " + (gettingState ? (gettingState?.description ?? "Unknown error") : "No response"));
        return;
    }

    const receivedState = gettingState.data.state;
    state = {
        playing: Boolean(receivedState.playing),
        bpm: Number(receivedState.bpm),
        clickVolume: Number(receivedState.clickVolume),
        timeSignature: receivedState.timeSignature,
        tapCount: Number(receivedState.tapCount),
        requiredTaps: Number(receivedState.requiredTaps),
        currentBeat: receivedState.currentBeat
    };

    ui.update();
}

function startStateUpdates() {
    if (ui.state.updateInterval) { return; }
    ui.state.updateInterval = setInterval(stateUpdate, 100);
}

function stopStateUpdates() {
    if (ui.state.updateInterval) {
        clearInterval(ui.state.updateInterval);
        ui.state.updateInterval = null;
    }
}

export async function initialize() {
    console.log("Initializing manual mode sidebar...");

    ui.elements.toggle = document.getElementById("manual-toggle");
    ui.elements.bpm = document.getElementById("manual-bpm");
    ui.elements.volumeClicker = document.getElementById("manual-volume-clicker");
    ui.elements.timeSignature = document.getElementById("manual-time-signature");
    ui.elements.tap = document.getElementById("manual-tap");

    ui.elements.toggle.addEventListener("click", ui.handlers.toggleClick);
    ui.elements.bpm.addEventListener("change", ui.handlers.bpmChange);
    ui.elements.bpm.addEventListener("input", ui.handlers.bpmFocus);
    ui.elements.bpm.addEventListener("focus", ui.handlers.bpmFocus);
    ui.elements.bpm.addEventListener("blur", ui.handlers.bpmBlur);
    ui.elements.volumeClicker.addEventListener("input", ui.handlers.volumeInput);
    ui.elements.timeSignature.addEventListener("change", ui.handlers.timeSignatureChange);
    ui.elements.tap.addEventListener("mousedown", ui.handlers.tapClick);

	browser.runtime.onMessage.addListener(async (message) => {
        if (Array.isArray(message?.type) && message.type[0] === "manual-mode" && message.type[1] === "force-update") {
            await stateUpdate();
        }
    });

    await stateUpdate();
} 