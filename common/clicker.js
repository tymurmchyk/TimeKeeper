/**
 * Interface for implementing clickers.
 * 
 * Clickers are node-like, meaning they have methods like connect, disconnect, etc,
 * but they are NOT guaranteed to close like standard AudioNodes.
 * 
 * Each clicker manages its own state and audio resources, providing a consistent interface,
 * for generating click sounds in different ways.
 * 
 * @abstract
 */
export class BaseClicker {
	/** @type {"ready" | "active" | "closed"} */
	_state = "ready";
	/** @type {AudioContext} */
	_context;
	/** @type {Object} */
	_options;
	/** @type {AudioNode[]} */
	_destinations = [];

	/**
	 * @param {AudioContext} context Audio context to use.
	 * @param {Object} options Options object, specific to each implementation.
	 */
	constructor(context, options = {}) {
		if (new.target === BaseClicker) {
			throw new TypeError("Cannot construct BaseClicker instances directly");
		}

		if (!(context instanceof BaseAudioContext)) {
			throw new TypeError(`\`context\` must be an audio context (${typeof context})`);
		}

		this._context = context;
		this._options = options;
	}
	
	/**
	 * Protected method for subclasses to modify state.
	 * @protected
	 * @param {"ready" | "active" | "closed"} newState New state to set.
	 * @throws {Error} If trying to change state from "closed" and if the new state value is illegal.
	 */
	set _state(newState) {
		if (this._state === "closed" && newState !== "closed") {
			throw new Error("Cannot change state once closed");
		}
		switch (newState) {
			case "ready":
			case "active":
			case "closed":
				this._state = newState;

			default: throw new Error(`Illegal state value (${newState})`);
		}
	}

	/** @returns {"ready" | "active" | "closed"} Current state of the clicker. */
	get state() { return this._state; }

	/** @returns {boolean} Whether the clicker is in closed state. */
	get isClosed() {
		return this._state === "closed";
	}

	/** Helper method that throws if the state of the clicker is closed. */
	_throwIfClosed() {
		if (this._state === "closed") {
			throw new Error("Clicker is closed");
		}
	}

	/** @returns {AudioContext} The audio context this clicker uses. */
	get context() { return this._context; }

	/**
	 * @protected
	 * @param {AudioNode} destination Destination node to add to the list.
	 */
	_addDestination(destination) {
		if (!this._destinations.includes(destination)) {
			this._destinations.push(destination);
		}
	}

	/**
	 * @protected
	 * @param {AudioNode} destination Destination node to remove from the list.
	 */
	_removeDestination(destination) {
		const index = this._destinations.indexOf(destination);
		if (index !== -1) {
			this._destinations.splice(index, 1);
		}
	}

	/**
	 * Connects the clicker's output to the destination node(s).
	 * @abstract
	 * @param {AudioNode | AudioNode[]} destination The destination node(s) to connect to.
	 */
	connect(destination) { throw new Error("`connect` must be implemented by derived class"); }

	/**
	 * Disconnects the clicker's output from the specified destination(s).
	 * 
	 * @abstract
	 * @param {null | AudioNode | AudioNode[]} destination The destination node(s) to disconnect from,
	 * or null to disconnect from all destinations.
	 */
	disconnect(destination = null) { throw new Error("`disconnect` must be implemented by derived class"); }

	/**
	 * Starts the clicker.
	 * @abstract
	 * @param {number} when Time offset in seconds when to start clicking.
	 */
	start(when = 0) { throw new Error("`start` must be implemented by derived class"); }

	/** @abstract */
	pause() { throw new Error("`pause` must be implemented by derived class"); }

	/** 
	 * Closes and cleans up the clicker.
	 * 
	 * After closing, the clicker becomes unusable and all resources are released.
	 * 
	 * @abstract 
	 */
	close() { throw new Error("`close` must be implemented by derived class"); }
}

/** Clicker that produces clicks at regular intervals. */
export class IntervalClicker extends BaseClicker {
	/**
	 * Minimal accepted interval between clicks.
	 * 
	 * This value is needed because IntervalClicker uses requestAnimationFrame for precise scheduling,
	 * which is tied directly to the refresh rate of the browser rendering,
	 * that is arbitrarily chosen to be 60 FPS.
	 */
	static MIN_INTERVAL = 1. / 60.;

	/** @type {OscillatorNode} */
	_currentSource = null;
	/** @type {OscillatorNode} */
	_futureSource = null;
	/** @type {number} */
	_interval = 0;
	/** @type {number} */
	_next = null;
	/** @type {number} */
	_clickDuration = 0.015;

	/**
	 * @param {AudioContext} context Audio context to use.
	 * @param {Object} options Oscillator options.
	 * @param {string} [options.type="square"] Oscillator type.
	 * @param {number} [options.frequency=440] Oscillator frequency in Hz.
	 */
	constructor(context, options = {}) {
		super(context, options);
		this._options = {
			type: options.type ?? "square",
			frequency: options.frequency ?? 440
		};
	}

	/**
	 * Creates a new oscillator node for producing a click.
	 * @protected
	 * @returns {OscillatorNode} Created oscillator.
	 */
	_makeSource() {
		const source = new OscillatorNode(this._context, this._options);
		for (let d = 0; d < this._destinations.length; d++) {
			source.connect(this._destinations[d]);
		}
		return source;
	}

	/**
	 * Disposes both sources if they are.
	 * @protected
	 */
	_disposeSources() {
		if (this._currentSource) {
			this._currentSource.stop();
			this._currentSource = null;
		}
		if (this._futureSource) {
			this._futureSource.stop();
			this._futureSource = null;
		}
	}

	/**
	 * Schedules click source to play.
	 * @param {OscillatorNode} source Click source to schedule.
	 * @param {number} when Click time.
	 * Note that it is relative to the context's `currentTime` value.
	 */
	_scheduleSource(source, when) {
		source.start(when);
		source.stop(when + this._clickDuration);
	}

	connect(destination) {
		this._throwIfClosed();

		if (!destination) {
			throw new TypeError(`No \`destination\` provided (${destination})`);
		}
		
		if (!Array.isArray(destination)) {
			destination = [destination];
		}

		for (let d = 0; d < destination.length; d++) {
			this._addDestination(destination[d])
			if (this._currentSource) { this._currentSource.connect(destination[d]); }
			if (this._futureSource) { this._futureSource.connect(destination[d]); }
		}
	}

	disconnect(destination = null) {
		this._throwIfClosed();

		if (destination === null) {
			this._destinations = [];
			if (this._currentSource) { this._currentSource.disconnect(); }
			if (this._futureSource) { this._futureSource.disconnect(); }
		}
		else {
			if (!Array.isArray(destination)) {
				destination = [destination];
			}
	
			for (let d = 0; d < destination.length; d++) {
				this._removeDestination(destination[d]);
				if (this._currentSource) { this._currentSource.disconnect(destination); }
				if (this._futureSource) { this._futureSource.disconnect(destination); }
			}
		}
	}

	/**
	 * (Re)starts the clicker and sets the state to "active".
	 * 
	 * Clicking starts at current time of the clicker's audio context
	 * plus specified `when` parameter (`this.context.currentTime + when`).
	 * 
	 * `interval` parameter is used for scheduling the future clicks.
	 * 
	 * Can be stopped using the `pause` method.
	 * 
	 * @param {number} when Time at which the first click must play.
	 * Note that it's relative to the context's `currentTime` value.
	 * @param {Object} interval Interval specifier.
	 * @param {number} [interval.time=0.5] Time of the interval.
	 * @param {"spc" | "bpm"} [interval.type = "spc"] Meaning of the `interval.time` value:
	 * - "spc": **S**econds **P**er **C**lick.
	 * - "bpm": **B**eats **P**er **M**inute.
	 */
	start(when = 0., interval = { time: 0.5, type: "spc" }) {
		this._throwIfClosed();

		if (typeof when !== "number"
			|| !isFinite(when)
			|| when < 0.)
		{
			throw new TypeError(`\`when\` must be a finite non-negative number (${when})`);
		}

		switch (interval.type) {
			case "spc":
				interval.time = interval.time;
				break;
			case "bpm":
				interval.time = 60. / interval.time;
				break;
			default:
				throw new TypeError(`\`interval.type\` must be either "spc" or "bpm" (${interval.type})`);
		}

		if (typeof interval.time !== "number"
			|| !isFinite(interval.time)
			|| interval.time < IntervalClicker.MIN_INTERVAL)
		{
			throw new Error(`\`interval.time\` must be a finite number >= ${IntervalClicker.MIN_INTERVAL} (${interval.time})`);
		}

		this._disposeSources();
		
		this._interval = interval.time;
		this._next = this._context.currentTime + when;
		
		this._currentSource = this._makeSource();
		this._scheduleSource(this._currentSource, this._next);

		const counter = () => {
			if (this._state !== "active") {
				return;
			}

			if (this._context.currentTime >= this._next) {
				this._next += this._interval;

				const click = this._makeSource();
				if (this._futureSource) { this._currentSource = this._futureSource; }
				this._futureSource = click;

				this._scheduleSource(click, this._next);
			}

			requestAnimationFrame(counter.bind(this));
		};
		
		requestAnimationFrame(counter.bind(this));

		this._state = "active";
	}

	/**
	 * Stops the scheduling and clicking, effectively pauses the clicker.
	 * Sets the clicker's state to "ready".
	 * 
	 * The instance can be started again with the `start` method.
	 */
	pause() {
		this._throwIfClosed();

		this._disposeSources();
		this._interval = null;
		this._next = null;

		this._state = "ready";
	}

	/**
	 * Closes this clicker.
	 * All fields are cleared and the state is set to "closed".
	 * 
	 * This instance becomes useless and should be disposed.
	 */
	close() {
		if (this._state === "closed") { return; }

		this.disconnect();
		this._disposeSources();
		this._context = null;
		this._interval = 0;
		this._next = 0;

		this._state = "closed";
	}
}

/** Clicker that produces clicks at known time points. */
export class ScheduledClicker extends BaseClicker {
	/** @type {OscillatorNode[]} */
	_sources = [];
	/** @type {number[]} */
	_clickTimes = null;
	/** @type {number} */
	_nextClickIndex = 0;
	
	_clickDuration = 0.015;

	/**
	 * @param {AudioContext} context Audio context to use.
	 * @param {Object} options Oscillator options.
	 * @param {string} [options.type="square"] Oscillator type.
	 * @param {number} [options.frequency=440] Oscillator frequency in Hz.
	 */
	constructor(context, options = {}) {
		super(context, options);
		this._options = {
			type: options.type ?? "square",
			frequency: options.frequency ?? 440
		};
	}

	/**
	 * Creates a new oscillator node for producing a click.
	 * @protected
	 * @returns {OscillatorNode} Created oscillator.
	 */
	_makeSource() {
		const source = new OscillatorNode(this._context, this._options);
		for (let d = 0; d < this._destinations.length; d++) {
			source.connect(this._destinations[d]);
		}
		return source;
	}

	/**
	 * Disposes source if it is.
	 * @protected
	 */
	_disposeSources() {
		while (this._sources.length) {
			this._sources[0].onended = ()=>{};
			this._sources[0].stop();
			this._sources.shift();
		}
	}

	/**
	 * Schedules click source to play.
	 * @param {OscillatorNode} source Click source to schedule.
	 * @param {number} when Click time.
	 * Note that it is relative to the context's `currentTime` value.
	 */
	_scheduleSource(source, when) {
		source.start(when);
		source.stop(when + this._clickDuration);
	}

	connect(destination) {
		this._throwIfClosed();

		if (!destination) {
			throw new Error(`No \`destination\` provided (${destination})`);
		}

		if (!Array.isArray(destination)) {
			destination = [destination];
		}

		for (let d = 0; d < destination.length; d++) {
			this._addDestination(destination[d]);
			for (let s = 0; s < this._sources.length; s++) {
				this._sources[s].connect(destination[d]);
			}
		}
	}

	disconnect(destination = null) {
		this._throwIfClosed();

		if (destination === null) {
			this._destinations = [];
			for (let s = 0; s < this._sources.length; s++) {
				this._sources[s].disconnect();
			}
		}
		else {
			if (!Array.isArray(destination)) {
				destination = [destination];
			}
	
			for (let d = 0; d < destination.length; d++) {
				this._removeDestination(destination[d]);
				for (let s = 0; s < this._sources.length; s++) {
					this._sources[s].disconnect(destination[d]);
				}
			}
		}
	}

	/**
	 * Starts playing clicks at the scheduled times.
	 * @param {Float32Array} clicks Array of timestamps in seconds when *consecutive* clicks should occur.
	 * @param {number} when Time at which the first click must play.
	 * Note that it's relative to the context's `currentTime` value.
	 * @param {number} firstClickAfter Time in seconds determining
	 * the time of the first click to be scheduled from the provided clicks.
	 * The time difference between this parameter and the time of the click
	 * offsets the click, so it's going to be silent.
	 */
	start(clicks, when = 0., firstClickAfter = 0.) {
		this._throwIfClosed();

		if (!clicks
			|| !(clicks instanceof Float32Array)
			|| !clicks.length)
		{
			throw new TypeError(`\`clicks\` must be a non-empty consecutive Float32Array (${clicks})`);
		}

		if (typeof when !== "number"
			|| !isFinite(when)
			|| when < 0.)
		{
			throw new TypeError(`\`when\` must be a finite number >= 0 (${when})`);
		}

		if (typeof firstClickAfter !== "number"
			|| !isFinite(firstClickAfter)
			|| firstClickAfter < 0.)
		{
			throw new TypeError(`\`offset\` must be a finite number >= 0 (${firstClickAfter})`);
		}

		this._disposeSources();

		let c = 0, next;
		while (c < clicks.length - 1 && clicks[c] < firstClickAfter) {
			next = clicks[c+1];
			if (clicks[c] >= next) {
				throw new Error(`\`clicks\` are not consecutive (${clicks[c]} >= ${next} ([${c}] >= [${c+1}]))`);
			}
			c++;
		}
		if (clicks[c] < firstClickAfter) {
			this.pause();
			return;
		}

		const schedule = () => {

		};

		let i = 0;
		while (c + i < clicks.length - 1) {
			next = clicks[c+i+1];
			if (clicks[c+i] >= next) {
				throw new Error(`\`clicks\` are not consecutive (${clicks[c]} >= ${next} ([${c}] >= [${c+1}]))`);
			}
			i++;
		}

		schedule();

		for (i = this._nextClickIndex; i < clicks.length; i++) {
			if (lastTime >= clicks[i]) {
				throw new Error(`\`clicks\` is an array of NON-CONSECUTIVE clicks (${lastTime} > ${clicks[i]} at indecies ${i-1} and ${i})`);
			}
			lastTime = clicks[i];

			const clickTime = startTime + (clicks[i] - firstClickAfter);
			const source = this._makeSource();
			this._sources.push(source);
			source.onended = () => {
				this._nextClickIndex++;
				this._sources.shift();
			};

			this._scheduleSource(source, clickTime);
		}

		this._state = "active";
	}

	pause() {
		this._throwIfClosed();

		this._disposeSources();
		this._clickTimes = [];
		this._nextClickIndex = 0;
		
		this._state = "ready";
	}

	close() {
		if (this._state === "closed") { return; }

		this.disconnect();
		this._disposeSources();
		this._context = null;
		this._clickTimes = null;

		this._state = "closed";
	}
}