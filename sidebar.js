import * as manualModeSidebar from "./manual-mode/sidebar.js";
import * as fileModeSidebar from "./file-mode/sidebar.js";

async function initialize() {
	await manualModeSidebar.initialize();
	
	await fileModeSidebar.initialize();
}

await initialize();