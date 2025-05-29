import * as fileModePopup from "./file-mode/sidebar.js";

async function initialize() {
	await fileModePopup.initialize();
}

await initialize();