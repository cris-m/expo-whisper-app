import { WhisperContext } from './ExpoWhisper';
import { AudioRecorder } from './AudioRecorder';
import type { ChunkedRealtimeOptions, ChunkedRealtimeEvent } from './ExpoWhisper.types';

export class RealtimeTranscriber {
	private contextRef: WhisperContext;
	private options: ChunkedRealtimeOptions;
	private onChunkComplete: ((event: ChunkedRealtimeEvent) => void) | null = null;
	private isActive = false;
	private isProcessing = false;
	private recorder: AudioRecorder | null = null;
	private chunkIndex = 0;
	private accumulatedTranscript = '';
	private allSegments: any[] = [];
	private lastChunkTime = Date.now();
	private chunkCheckInterval: NodeJS.Timeout | null = null;
	private chunkDurationMs: number;

	constructor(context: WhisperContext, options: ChunkedRealtimeOptions = {}) {
		this.contextRef = context;
		this.options = options;
		// Cap duration to 5 seconds to prevent buffer overflow
		// Each second requires 16000 Hz × 2 bytes/sample = 32KB minimum
		const requestedDuration = options.chunkDurationMs || 15000;
		this.chunkDurationMs = Math.min(requestedDuration, 5000);
		if (this.chunkDurationMs < requestedDuration) {
			console.warn(`[Realtime] Capping chunk duration from ${requestedDuration}ms to ${this.chunkDurationMs}ms to prevent buffer overflow`);
		}
	}

	async start(onChunkComplete: (event: ChunkedRealtimeEvent) => void): Promise<void> {
		this.onChunkComplete = onChunkComplete;
		this.isActive = true;
		this.chunkIndex = 0;
		this.accumulatedTranscript = '';
		this.allSegments = [];
		this.lastChunkTime = Date.now();

		try {
			// Create recorder with duration matching chunk size (plus 2 second buffer)
			const durationSeconds = Math.ceil(this.chunkDurationMs / 1000) + 2;
			this.recorder = new AudioRecorder(durationSeconds);
			this.recorder.setContextId(this.contextRef.id);
			await this.recorder.start();
			
			this.chunkCheckInterval = setInterval(() => {
				this.checkAndProcessChunk();
			}, 1000);
			
		} catch (error) {
			this.isActive = false;
			console.error('[Realtime] Start failed:', error);
			throw error;
		}
	}

	async stop(): Promise<void> {
		this.isActive = false;

		if (this.chunkCheckInterval) {
			clearInterval(this.chunkCheckInterval);
			this.chunkCheckInterval = null;
		}

		if (this.recorder) {
			await this.recorder.stop();
		}

		this.onChunkComplete?.({
			contextId: this.contextRef.id,
			jobId: 0,
			accumulatedTranscript: this.accumulatedTranscript,
			allSegments: this.allSegments,
			isCapturing: false,
			isProcessing: false,
			currentChunkIndex: this.chunkIndex,
			chunkProgress: 0,
		});
	}

	private async checkAndProcessChunk(): Promise<void> {
		if (!this.isActive || !this.recorder || this.isProcessing) return;

		const now = Date.now();
		const elapsed = now - this.lastChunkTime;

		if (elapsed >= this.chunkDurationMs) {
			this.lastChunkTime = now;
			await this.processChunk();
		}
	}

	private async processChunk(): Promise<void> {
		if (this.isProcessing || !this.isActive || !this.onChunkComplete || !this.recorder) return;

		this.isProcessing = true;

		try {
			const startTime = Date.now();

			// Stop recording and get audio data
			const audioData = await this.recorder.stop();

			// Log audio data size for debugging
			console.log(`[Realtime] Chunk ${this.chunkIndex}: Captured ${audioData.byteLength} bytes`);

			// Check if we have any audio data
			if (!audioData || audioData.byteLength === 0) {
				console.warn(`[Realtime] Chunk ${this.chunkIndex}: No audio data captured (0 bytes)`);
				this.onChunkComplete({
					contextId: this.contextRef.id,
					jobId: 0,
					chunk: {
						chunkIndex: this.chunkIndex,
						startTime: this.chunkIndex * this.chunkDurationMs,
						endTime: (this.chunkIndex + 1) * this.chunkDurationMs,
						duration: this.chunkDurationMs,
						transcript: '',
						segments: [],
						processTime: 0,
					},
					accumulatedTranscript: this.accumulatedTranscript,
					allSegments: this.allSegments,
					isCapturing: this.isActive,
					isProcessing: false,
					currentChunkIndex: this.chunkIndex,
					chunkProgress: 0,
				});

				this.chunkIndex++;

				// Restart recording
				if (this.isActive) {
					const durationSeconds = Math.ceil(this.chunkDurationMs / 1000) + 2;
					this.recorder = new AudioRecorder(durationSeconds);
					this.recorder.setContextId(this.contextRef.id);
					await this.recorder.start();
				}
				return;
			}

			const jobId = Math.floor(Math.random() * 10000);

			const transcribeOptions = {
				// Basic options
				language: this.options.language || 'en',
				translate: this.options.translate || false,
				maxTokens: this.options.maxTokens || 0,

				// Advanced sampling
				temperature: this.options.temperature,
				samplingStrategy: this.options.samplingStrategy,
				greedyBestOf: this.options.greedyBestOf,
				beamSearchBeamSize: this.options.beamSearchBeamSize,

				// Quality tuning
				tokenTimestamps: this.options.tokenTimestamps,
				suppressBlank: this.options.suppressBlank,
				suppressNst: this.options.suppressNst,
				initialPrompt: this.options.initialPrompt,

				// Thresholds
				temperatureInc: this.options.temperatureInc,
				entropyThold: this.options.entropyThold,
				noSpeechThold: this.options.noSpeechThold,

				// VAD parameters
				enableVad: this.options.enableVad,
				vadThreshold: this.options.vadThreshold,
				minSpeechDurationMs: this.options.minSpeechDurationMs,
				minSilenceDurationMs: this.options.minSilenceDurationMs,
			};

			const { promise } = this.contextRef.transcribeBuffer(audioData, transcribeOptions);

			const result = await promise;
			const processTime = Date.now() - startTime;

			const chunkTranscript = result.result || '';
			this.accumulatedTranscript += (this.accumulatedTranscript && chunkTranscript ? ' ' : '') + chunkTranscript;
			if (result.segments) {
				this.allSegments = [...this.allSegments, ...result.segments];
			}


			this.onChunkComplete({
				contextId: this.contextRef.id,
				jobId,
				chunk: {
					chunkIndex: this.chunkIndex,
					startTime: this.chunkIndex * this.chunkDurationMs,
					endTime: (this.chunkIndex + 1) * this.chunkDurationMs,
					duration: this.chunkDurationMs,
					transcript: chunkTranscript,
					segments: result.segments || [],
					processTime,
				},
				accumulatedTranscript: this.accumulatedTranscript,
				allSegments: this.allSegments,
				isCapturing: this.isActive,
				isProcessing: false,
				currentChunkIndex: this.chunkIndex,
				chunkProgress: 100,
			});

			this.chunkIndex++;

			// Restart recording with fresh recorder instance
			if (this.isActive) {
				const durationSeconds = Math.ceil(this.chunkDurationMs / 1000) + 2;
				this.recorder = new AudioRecorder(durationSeconds);
				this.recorder.setContextId(this.contextRef.id);
				await this.recorder.start();
			}

		} catch (error) {
			console.error(`[Realtime] Chunk ${this.chunkIndex} failed:`, error);

			if (this.onChunkComplete) {
				this.onChunkComplete({
					contextId: this.contextRef.id,
					jobId: 0,
					accumulatedTranscript: this.accumulatedTranscript,
					allSegments: this.allSegments,
					isCapturing: this.isActive,
					isProcessing: false,
					currentChunkIndex: this.chunkIndex,
					chunkProgress: 0,
					error: String(error),
				});
			}

			try {
				if (this.isActive) {
					const durationSeconds = Math.ceil(this.chunkDurationMs / 1000) + 2;
					this.recorder = new AudioRecorder(durationSeconds);
					this.recorder.setContextId(this.contextRef.id);
					await this.recorder.start();
				}
			} catch (restartError) {
				console.error('[Realtime] Restart failed:', restartError);
			}
		} finally {
			this.isProcessing = false;
		}
	}
}