export let state = {
    /** @type {{ name: string, type: string, size: number } | null} */
    file: null,
    /** @type {boolean} */
    playing: false,
    /** @type {number} */
    songVolume: .5,
    /** @type {number} */
    clickVolume: .5,
    /** @type {number | null} */
    duration: null,
    /** @type {number | null} */
    contextTimeAtStart: null,
    /** @type {number | null} */
    songTimeLast: null,
    /** @type {number | null} */
    songTimeAtStart: null,
    /** @type {{ bpm: number, beats: Float32Array, completed: boolean } | null} */
    analysis: null,
    /** @type {number} */
    tempoPower: 0,
    /** @type {number} */
    clickOffset: 0.
};