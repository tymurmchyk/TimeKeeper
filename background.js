import { sendMessage, findHandler } from "./common/runtime-messaging.js";

import * as manualMode from "./manual-mode/background.js";
import * as fileMode from "./file-mode/background.js";

if (typeof browser === "undefined") {
	var browser = chrome;
}

const messageHandlers = {
	"hello"(message) {
		console.log(message?.data);
		return {
			type: "success",
			data: "Hello to you too!"
		};
	},

	"manual-mode": manualMode.messageHandlers,
	
	"file-mode": fileMode.messageHandlers
};

function runtimeMessageListener(message, sender, sendResponse) {
	const handle = findHandler(message.type, messageHandlers);
	if (handle !== null) {
		const response = handle(message);
		if (response?.then) {
			response.then(sendResponse);
			return true;
		}
		else {
			sendResponse(response);
			return;
		}
	}
	else {
		console.error("Message handler not found!");
		return;
	}
}

browser.runtime.onMessage.addListener(runtimeMessageListener);