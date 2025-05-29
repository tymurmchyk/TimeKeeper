export function kebabToSnake(string) {
	if (typeof string !== "string") {
		throw new TypeError(`\`string\` must be of type "string" (${typeof string})`);
	}

	const words = string.split("-");
	let newString = words[0];
	for (let w = 1; w < words.length; w++) {
		newString += words[w].charAt(0).toUpperCase() + words[w].slice(1);
	}
	return newString;
}

export function formatTime(seconds) {
	if (!seconds || isNaN(seconds)) return "--:--";
	const mins = Math.floor(seconds / 60);
	const secs = Math.floor(seconds % 60);
	return `${mins}:${secs.toString().padStart(2, '0')}`;
}