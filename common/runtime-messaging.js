if (typeof browser === "undefined") {
	var browser = chrome;
}

export function sendMessage(message) {
	return new Promise((res) => { browser.runtime.sendMessage(message, res); }) ;
}

export function findHandler(type, handlers, typeDepth = 0) {
	if (Array.isArray(type)) {
		var handle = handlers[type[typeDepth]];
	}
	else {
		var handle = handlers[type];
	}
	if (handle !== undefined) {
		if (typeof handle === "function") { return handle; }
		else { return findHandler(type, handle, typeDepth + 1); }
	}
	return null;
}