export let state = {
    /** @type {boolean} */
    playing: false,
    /** @type {number} */
    bpm: 120,
    /** @type {number} */
    clickVolume: 0.5,
    /** @type {string} */
    timeSignature: "4/4",
    /** @type {number[]} */
    tapTimes: [],
    /** @type {number} */
    tapCount: 0,
    /** @type {number | null} */
    lastTapTime: null
}; 