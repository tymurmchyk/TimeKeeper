import Essentia from '../library/essentia/essentia.js-core.es.js';
import { EssentiaWASM } from '../library/essentia/essentia-wasm.es.js';

const es = new Essentia(EssentiaWASM);

/**
 * Analyzes audio channels to extract rhythm information
 * @param {Float32Array[]} channels Array of audio channels
 * @returns {Object} Analysis results including BPM and beat positions
 */
export function analyzeRhythm(channels) {
    let signal;
    
    switch (channels.length) {
        case 1:
            signal = es.arrayToVector(channels[0]);
            break;
        case 2:
            const left = es.arrayToVector(channels[0]),
                right = es.arrayToVector(channels[1]);
            signal = es.MonoMixer(left, right).audio;
            break;

        default: throw new Error("Illegal number of channels");
    }

    // Apply preprocessing to improve beat detection
    const filtered = es.LowPass(signal, 700).signal;  // Filter out high frequencies
    
    // Try different algorithms and parameters
    const rhythm = es.RhythmExtractor2013(filtered, 250, "degara", true);
    console.debug("Rhythm analysis results:", {
        bpm: rhythm.bpm,
        confidence: rhythm.confidence,
        estimates: es.vectorToArray(rhythm.estimates),
        bpmIntervals: es.vectorToArray(rhythm.bpmIntervals)
    });

    // Get beat positions
    const beats = es.vectorToArray(rhythm.ticks);

    // Validate and clean up beat positions
    const validatedBeats = beats.filter((beat, i, arr) => {
        if (i === 0) return true;
        // Filter out beats that are too close together (less than 200ms)
        return (beat - arr[i-1]) >= 0.2;
    });

    return {
        bpm: rhythm.bpm,
        beats: validatedBeats,
        confidence: rhythm.confidence,
        estimates: es.vectorToArray(rhythm.estimates),
        bpmIntervals: es.vectorToArray(rhythm.bpmIntervals)
    };
}

// Worker message handling
onmessage = (event) => {
    const message = event.data;

    switch (message.type) {
        case "hello":
            console.log("Got a hello:", message.description);
            postMessage({
                type: "hello",
                description: "Hello!"
            })
            break;

        case "analyse":
            if (message.data?.channels) {
                const result = analyzeRhythm(message.data.channels);
                postMessage({
                    type: "result",
                    data: { result }
                });
            }
            break;

        default: throw new Error(`Illegal analyser message type: ${message.type}`);
    }
}; 