/**
 * Type conversion utilities
 */

/**
 * Convert Uint8Array to base64 string
 */
export function uint8ArrayToBase64(uint8Array: Uint8Array): string {
	const binaryString = Array.from(uint8Array, byte => String.fromCharCode(byte)).join('');
	return globalThis.btoa ? globalThis.btoa(binaryString) : Buffer.from(binaryString).toString('base64');
}

/**
 * Convert base64 string to Uint8Array
 */
export function base64ToUint8Array(base64String: string): Uint8Array {
	const binaryString = globalThis.atob
		? globalThis.atob(base64String)
		: Buffer.from(base64String, 'base64').toString('binary');

	const bytes = new Uint8Array(binaryString.length);
	for (let i = 0; i < binaryString.length; i++) {
		bytes[i] = binaryString.charCodeAt(i);
	}
	return bytes;
}

/**
 * Convert AudioBuffer to Uint8Array (16-bit PCM)
 */
export function audioBufferToUint8Array(audioBuffer: AudioBuffer): Uint8Array {
	const numberOfChannels = audioBuffer.numberOfChannels;
	const sampleRate = audioBuffer.sampleRate;
	const length = audioBuffer.length * numberOfChannels * 2;
	const audioData = new Float32Array(audioBuffer.length);
	const channelData = audioBuffer.getChannelData(0);
	audioData.set(channelData);

	const int16Array = new Int16Array(length / 2);
	let index = 0;

	for (let i = 0; i < audioData.length; i++) {
		const sample = Math.max(-1, Math.min(1, audioData[i]));
		int16Array[index++] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
	}

	return new Uint8Array(int16Array.buffer);
}

/**
 * Convert Uint8Array to AudioBuffer
 */
export async function uint8ArrayToAudioBuffer(
	uint8Array: Uint8Array,
	audioContext: AudioContext,
): Promise<AudioBuffer> {
	const int16Array = new Int16Array(uint8Array.buffer, uint8Array.byteOffset, uint8Array.length / 2);
	const float32Array = new Float32Array(int16Array.length);

	for (let i = 0; i < int16Array.length; i++) {
		const int16 = int16Array[i];
		float32Array[i] = int16 < 0 ? int16 / 0x8000 : int16 / 0x7fff;
	}

	const audioBuffer = audioContext.createBuffer(1, float32Array.length, 16000);
	const channelData = audioBuffer.getChannelData(0);
	channelData.set(float32Array);

	return audioBuffer;
}

/**
 * Convert duration from centiseconds to milliseconds
 */
export function centisecondsToMilliseconds(centiseconds: number): number {
	return centiseconds * 10;
}

/**
 * Convert duration from milliseconds to centiseconds
 */
export function millisecondsTocentiseconds(milliseconds: number): number {
	return Math.round(milliseconds / 10);
}

/**
 * Format time duration for display
 */
export function formatDuration(milliseconds: number): string {
	const totalSeconds = Math.floor(milliseconds / 1000);
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	const ms = milliseconds % 1000;

	if (minutes > 0) {
		return `${minutes}m ${seconds}s`;
	} else if (seconds > 0) {
		return `${seconds}s`;
	} else {
		return `${ms}ms`;
	}
}

/**
 * Format bytes for display
 */
export function formatBytes(bytes: number, decimals: number = 2): string {
	if (bytes === 0) return '0 Bytes';

	const k = 1024;
	const dm = decimals < 0 ? 0 : decimals;
	const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
	const i = Math.floor(Math.log(bytes) / Math.log(k));

	return Math.round((bytes / Math.pow(k, i)) * Math.pow(10, dm)) / Math.pow(10, dm) + ' ' + sizes[i];
}

/**
 * Clamp a number between min and max
 */
export function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

/**
 * Create a unique ID
 */
export function generateId(prefix: string = ''): string {
	const timestamp = Date.now().toString(36);
	const random = Math.random().toString(36).substring(2, 11);
	return prefix ? `${prefix}-${timestamp}-${random}` : `${timestamp}-${random}`;
}
