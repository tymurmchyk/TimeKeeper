console.log("Test worker starting");

onmessage = (e) => {
	console.log("Test worker received message:", e.data);
	postMessage("Hello from test worker!");
};

throw new Error("Test worker error");