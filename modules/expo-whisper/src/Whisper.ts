/**
 * Whisper: Unified main entry point for expo-whisper
 *
 * Provides high-level API for speech-to-text transcription using whisper.cpp
 * with integrated task tracking and realtime streaming support.
 *
 * Usage:
 * ```typescript
 * // Initialize
 * const whisper = await Whisper.initialize({ modelPath: '...' });
 *
 * // Transcribe file
 * const task = await whisper.transcribeFile('audio.wav', {
 *   language: 'en',
 *   onProgress: (p) => console.log(p + '%')
 * });
 * console.log(task.result?.text);
 *
 * // Realtime transcription
 * await whisper.startRealtime();
 * const result = await whisper.stopRealtime();
 * console.log(result.text);
 * ```
 */

import { ExpoWhisper } from './NativeModuleWrapper';
import { uint8ArrayToBase64 } from './utils/Converters';
import { getLogger } from './utils/Logger';
import type {
	TranscribeResult,
	Segment,
	TranscriptionTask,
	RealtimeState,
} from './types/whisper';

const logger = getLogger();

export interface WhisperInitOptions {
	modelPath: string;
	useGpu?: boolean;
	useCoreMLIos?: boolean;
	useFlashAttn?: boolean;
	useNnapi?: boolean;
	useGpuDelegate?: boolean;
}

export interface TranscribeOptions {
	language?: string;
	temperature?: number;
	beamSize?: number;
	translate?: boolean;
	maxTokens?: number;
	suppressBlank?: boolean;
	suppressNst?: boolean;
	onProgress?: (progress: number) => void;
	onSegment?: (segment: Segment) => void;
}

export class Whisper {
	private contextId: number | null = null;
	private modelPath: string = '';

	private tasks = new Map<string, TranscriptionTask>();
	private tasksByJobId = new Map<number, string>();
	private nextTaskId = 1;

	private realtimeState: RealtimeState | null = null;
	private realtimeSubscriptions: Array<{ remove: () => void }> = [];

	private static instance: Whisper | null = null;

	private constructor() { }

	/**
	 * Initialize the Whisper transcriber
	 *
	 * @param options Initialization options
	 * @returns Initialized Whisper instance
	 */
	static async initialize(options: WhisperInitOptions): Promise<Whisper> {
		if (Whisper.instance) {
			logger.info('[Whisper] Already initialized, returning existing instance');
			return Whisper.instance;
		}

		const instance = new Whisper();
		instance.modelPath = options.modelPath;

		try {
			logger.info('[Whisper] Initializing...', { modelPath: options.modelPath });

			const result = await ExpoWhisper.initContext({
				filePath: options.modelPath,
				useGpu: options.useGpu ?? true,
				useCoreMLIos: options.useCoreMLIos ?? true,
				useFlashAttn: options.useFlashAttn ?? false,
				useNnapi: options.useNnapi ?? true,
				useGpuDelegate: options.useGpuDelegate ?? false,
			});

			instance.contextId = result.contextId;

			logger.info('[Whisper] Initialized successfully', {
				contextId: result.contextId,
				gpu: result.gpu,
			});

			Whisper.instance = instance;
			return instance;
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			logger.error('[Whisper] Initialization failed:', { error: errorMessage });
			throw error;
		}
	}

	private generateTaskId(): string {
		return `task-${this.nextTaskId++}-${Date.now()}`;
	}

	private createTask(
		type: 'file' | 'buffer' | 'recording' | 'realtime'
	): TranscriptionTask {
		const taskId = this.generateTaskId();
		const jobId = Math.floor(Math.random() * 100000);

		const task: TranscriptionTask = {
			taskId,
			type,
			status: 'queued',
			progress: 0,
			startTime: Date.now(),
			cancel: async () => {
				task.status = 'cancelled';
				logger.info('[Whisper] Task cancelled', { taskId });
			},
			getProgress: () => {
				const now = Date.now();
				const elapsed = now - task.startTime;
				const estimated = elapsed / (task.progress / 100);
				return {
					progress: task.progress,
					processingTimeMs: elapsed,
					estimatedRemainingMs: Math.max(0, estimated - elapsed),
				};
			},
		};

		this.tasks.set(taskId, task);
		this.tasksByJobId.set(jobId, taskId);

		return task;
	}

	/**
	 * Transcribe an audio file
	 *
	 * @param filePath Path to audio file
	 * @param options Transcription options
	 * @returns Promise resolving to transcription task
	 */
	async transcribeFile(
		filePath: string,
		options: TranscribeOptions = {}
	): Promise<TranscriptionTask> {
		if (!this.contextId) {
			throw new Error('[Whisper] Not initialized');
		}

		const task = this.createTask('file');
		const jobId = Array.from(this.tasksByJobId.entries()).find(
			([_, id]) => id === task.taskId
		)?.[0];

		if (!jobId) {
			throw new Error('[Whisper] Failed to allocate job ID');
		}

		try {
			logger.info('[Whisper] Starting file transcription', {
				taskId: task.taskId,
				jobId,
				filePath,
				language: options.language,
			});

			task.status = 'processing';

			const subscriptions: Array<{ remove: () => void }> = [];

			if (options.onProgress) {
				const sub = ExpoWhisper.addListener(
					'onTranscribeProgress',
					(event: any) => {
						if (event.contextId === this.contextId && event.jobId === jobId) {
							task.progress = event.progress;
							options.onProgress!(event.progress);
						}
					}
				);
				subscriptions.push(sub);
			}

			if (options.onSegment) {
				const sub = ExpoWhisper.addListener(
					'onTranscribeNewSegments',
					(event: any) => {
						if (event.contextId === this.contextId && event.jobId === jobId) {
							options.onSegment!(event.result);
						}
					}
				);
				subscriptions.push(sub);
			}

			const result = await ExpoWhisper.transcribeFile(
				this.contextId,
				jobId,
				filePath,
				{
					language: options.language || 'auto',
					temperature: options.temperature || 0.0,
					beamSearchBeamSize: options.beamSize || 5,
					onProgress: !!options.onProgress,
					onNewSegments: !!options.onSegment,
				}
			);

			subscriptions.forEach((sub) => sub.remove?.());

			task.status = 'complete';
			task.endTime = Date.now();
			task.progress = 100;
			task.result = {
				text: result.text,
				segments: result.segments || [],
				duration: result.duration,
				language: result.language,
				processingTimeMs: task.endTime - task.startTime,
			};

			logger.info('[Whisper] File transcription complete', {
				taskId: task.taskId,
				textLength: result.text.length,
			});

			return task;
		} catch (error) {
			task.status = 'error';
			task.endTime = Date.now();
			task.error = error instanceof Error ? error : new Error(String(error));
			const errorMessage = task.error.message;
			logger.error('[Whisper] File transcription failed:', { error: errorMessage });
			throw error;
		} finally {
			this.tasksByJobId.delete(jobId);
		}
	}

	/**
	 * Transcribe audio buffer
	 *
	 * @param audioBuffer Audio data as Uint8Array
	 * @param options Transcription options
	 * @returns Promise resolving to transcription task
	 */
	async transcribeBuffer(
		audioBuffer: Uint8Array,
		options: TranscribeOptions = {}
	): Promise<TranscriptionTask> {
		if (!this.contextId) {
			throw new Error('[Whisper] Not initialized');
		}

		const task = this.createTask('buffer');
		const jobId = Array.from(this.tasksByJobId.entries()).find(
			([_, id]) => id === task.taskId
		)?.[0];

		if (!jobId) {
			throw new Error('[Whisper] Failed to allocate job ID');
		}

		try {
			logger.info('[Whisper] Starting buffer transcription', {
				taskId: task.taskId,
				jobId,
				bufferSize: audioBuffer.length,
				language: options.language,
			});

			task.status = 'processing';

			const audioBase64 = uint8ArrayToBase64(audioBuffer);

			const subscriptions: Array<{ remove: () => void }> = [];

			if (options.onProgress) {
				const sub = ExpoWhisper.addListener(
					'onTranscribeProgress',
					(event: any) => {
						if (event.contextId === this.contextId && event.jobId === jobId) {
							task.progress = event.progress;
							options.onProgress!(event.progress);
						}
					}
				);
				subscriptions.push(sub);
			}

			if (options.onSegment) {
				const sub = ExpoWhisper.addListener(
					'onTranscribeNewSegments',
					(event: any) => {
						if (event.contextId === this.contextId && event.jobId === jobId) {
							options.onSegment!(event.result);
						}
					}
				);
				subscriptions.push(sub);
			}

			const result = await ExpoWhisper.transcribeBuffer(
				this.contextId,
				jobId,
				audioBase64,
				{
					language: options.language || 'auto',
					temperature: options.temperature || 0.0,
					beamSearchBeamSize: options.beamSize || 5,
					onProgress: !!options.onProgress,
					onNewSegments: !!options.onSegment,
				}
			);

			subscriptions.forEach((sub) => sub.remove?.());

			task.status = 'complete';
			task.endTime = Date.now();
			task.progress = 100;
			task.result = {
				text: result.text,
				segments: result.segments || [],
				duration: result.duration,
				language: result.language,
				processingTimeMs: task.endTime - task.startTime,
			};

			logger.info('[Whisper] Buffer transcription complete', {
				taskId: task.taskId,
				textLength: result.text.length,
			});

			return task;
		} catch (error) {
			task.status = 'error';
			task.endTime = Date.now();
			task.error = error instanceof Error ? error : new Error(String(error));
			const errorMessage = task.error.message;
			logger.error('[Whisper] Buffer transcription failed:', { error: errorMessage });
			throw error;
		} finally {
			this.tasksByJobId.delete(jobId);
		}
	}

	/**
	 * Record and transcribe audio with callback pattern
	 *
	 * @returns Object with stop() method and promise
	 */
	recordAndTranscribe(): {
		stop: (options?: TranscribeOptions) => Promise<TranscribeResult>;
		promise: Promise<TranscribeResult>;
	} {
		if (!this.contextId) {
			throw new Error('[Whisper] Not initialized. Call initialize() first.');
		}

		let resolvePromise: ((value: TranscribeResult) => void) | null = null;
		let rejectPromise: ((error: any) => void) | null = null;
		let isRecordingActive = false;

		const promise = new Promise<TranscribeResult>((resolve, reject) => {
			resolvePromise = resolve;
			rejectPromise = reject;
		});

		const stop = async (options: TranscribeOptions = {}): Promise<TranscribeResult> => {
			if (!isRecordingActive) {
				logger.warn('[Whisper] Stop called but recording not active');
				return {
					text: '',
					segments: [],
					duration: 0,
					language: options.language || 'auto',
				};
			}

			try {
				logger.info('[Whisper] Recording stopped by user, transcribing...');
				isRecordingActive = false;

				const result = await ExpoWhisper.stopRecording(
					this.contextId!,
					options
				);
				logger.info('[Whisper] Recording transcribed successfully', {
					textLength: result.text?.length || 0,
				});

				if (resolvePromise) {
					resolvePromise(result);
				}

				return result;
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				logger.error('[Whisper] Recording failed:', { error: errorMessage });

				if (rejectPromise) {
					rejectPromise(error);
				}

				throw error;
			}
		};

		// Auto-start buffer recording
		ExpoWhisper.startBufferRecording(this.contextId)
			.then(() => {
				isRecordingActive = true;
				logger.info('[Whisper] Recording started');
			})
			.catch((error) => {
				const errorMessage = error instanceof Error ? error.message : String(error);
				logger.error('[Whisper] Failed to start recording:', { error: errorMessage });
				isRecordingActive = false;
				if (rejectPromise) {
					rejectPromise(error);
				}
			});

		return { stop, promise };
	}

	/**
	 * Start buffer-based recording from microphone (batch mode)
	 *
	 * Records audio to memory buffer. Call stopRecording() to transcribe the entire recording.
	 *
	 * @returns Promise resolving to recording status
	 * @see startRealtime() for real-time transcription while user speaks
	 */
	async startRecording(): Promise<{ recording: boolean }> {
		if (!this.contextId) {
			const error = new Error('No active context. Call initialize() first.');
			logger.error('[Whisper] Cannot start recording:', { error: error.message });
			throw error;
		}

		try {
			logger.info('[Whisper] Starting buffer-based microphone recording');

			const recordingId = await ExpoWhisper.startBufferRecording(this.contextId);

			logger.info('[Whisper] Buffer recording started successfully', { recordingId });
			return { recording: true };
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			logger.error('[Whisper] Failed to start recording:', { error: errorMessage });
			throw error;
		}
	}

	/**
	 * Stop recording and transcribe (batch mode)
	 *
	 * Stops the recording started by startRecording() and transcribes the entire buffered audio.
	 *
	 * @param options Transcription options
	 * @returns Promise resolving to transcription task with final results
	 * @see startRecording() to begin batch recording
	 * @see startRealtime() for real-time transcription alternative
	 */
	async stopRecording(options: TranscribeOptions = {}): Promise<TranscriptionTask> {
		if (!this.contextId) {
			const error = new Error('No active context. Call initialize() first.');
			logger.error('[Whisper] Cannot stop recording:', { error: error.message });
			throw error;
		}

		const task = this.createTask('recording');
		const jobId = Array.from(this.tasksByJobId.entries()).find(
			([_, id]) => id === task.taskId
		)?.[0];

		if (!jobId) {
			throw new Error('[Whisper] Failed to allocate job ID');
		}

		try {
			logger.info('[Whisper] Stopping recording and transcribing...', { taskId: task.taskId });
			task.status = 'processing';

			const audioBase64 = await ExpoWhisper.stopBufferRecording(this.contextId);

			logger.info('[Whisper] Buffer recording stopped, transcribing...', {
				audioSize: audioBase64.length
			});

			const result = await ExpoWhisper.transcribeBuffer(
				this.contextId,
				jobId,
				audioBase64,
				{
					language: options.language || 'auto',
					temperature: options.temperature || 0.0,
					beamSearchBeamSize: options.beamSize || 5,
				}
			);

			task.status = 'complete';
			task.endTime = Date.now();
			task.progress = 100;
			task.result = {
				text: result.text,
				segments: result.segments || [],
				duration: result.duration,
				language: result.language,
				processingTimeMs: task.endTime - task.startTime,
			};

			logger.info('[Whisper] Recording transcribed successfully', { taskId: task.taskId });
			return task;
		} catch (error) {
			task.status = 'error';
			task.endTime = Date.now();
			task.error = error instanceof Error ? error : new Error(String(error));
			const errorMessage = task.error.message;
			logger.error('[Whisper] Failed to stop recording:', { error: errorMessage });
			throw error;
		} finally {
			this.tasksByJobId.delete(jobId);
		}
	}

	/**
	 * Start realtime transcription from microphone (streaming mode)
	 *
	 * Transcribes audio continuously as you speak. Call stopRealtime() to stop streaming and get accumulated results.
	 *
	 * @param maxDurationSeconds Maximum streaming duration in seconds
	 * @param callbacksOrOptions Callbacks for realtime events and transcription options
	 * @returns Promise resolving when streaming starts
	 * @see stopRealtime() to end streaming and retrieve accumulated results
	 * @see startRecording() for batch recording alternative
	 */
	async startRealtime(
		maxDurationSeconds: number = 300,
		callbacksOrOptions?: {
			onSegment?: (segment: Segment) => void;
			onAudioLevel?: (level: number) => void;
		} & Partial<TranscribeOptions>
	): Promise<void> {
		if (!this.contextId) {
			throw new Error('[Whisper] Not initialized');
		}

		if (this.realtimeState?.isStreaming) {
			throw new Error('[Whisper] Already streaming');
		}

		const jobId = Math.floor(Math.random() * 100000);

		try {
			logger.info('[Whisper] Starting realtime transcription', {
				maxDurationSeconds,
				jobId,
			});

			this.realtimeState = {
				isStreaming: true,
				accumulatedText: '',
				accumulatedSegments: [],
			};

			const sub = ExpoWhisper.addListener('onRealtimeTranscribe', (event: any) => {
				if (event.contextId === this.contextId && this.realtimeState) {
					logger.debug('[Whisper] Realtime event received:', {
						eventKeys: Object.keys(event),
						payloadKeys: event.payload ? Object.keys(event.payload) : 'no payload',
						payloadType: typeof event.payload,
					});

					if (event.payload?.text) {
						this.realtimeState.accumulatedText +=
							(this.realtimeState.accumulatedText ? ' ' : '') + event.payload.text;
						logger.debug('[Whisper] Text accumulated:', {
							text: event.payload.text,
						});
					}

					const audioLevel = event.payload?.audioLevel ?? event.audioLevel;
					if (audioLevel !== undefined && callbacksOrOptions?.onAudioLevel) {
						logger.debug('[Whisper] Audio level:', { level: audioLevel });
						callbacksOrOptions.onAudioLevel(audioLevel);
					}

					if (event.payload?.segments && Array.isArray(event.payload.segments)) {
						logger.debug('[Whisper] Segments received:', {
							count: event.payload.segments.length,
						});
						event.payload.segments.forEach((segment: Segment) => {
							this.realtimeState!.accumulatedSegments.push(segment);

							if (callbacksOrOptions?.onSegment) {
								callbacksOrOptions.onSegment(segment);
							}
						});
					} else {
						logger.debug('[Whisper] No segments array in payload:', {
							hasPayload: !!event.payload,
							payloadContent: event.payload ? JSON.stringify(event.payload) : null,
						});
					}
				}
			});
			this.realtimeSubscriptions.push(sub);

			logger.info('[Whisper] Calling native startRealtimeTranscribe with options:', {
				language: callbacksOrOptions?.language || 'auto',
			});

			try {
				await ExpoWhisper.startRealtimeTranscribe(this.contextId, jobId, {
					maxDurationSeconds,
					language: callbacksOrOptions?.language || 'auto',
					temperature: callbacksOrOptions?.temperature || 0.0,
					beamSearchBeamSize: callbacksOrOptions?.beamSize || 5,
					translate: callbacksOrOptions?.translate ?? false,
					maxTokens: callbacksOrOptions?.maxTokens ?? 0,
					suppressBlank: callbacksOrOptions?.suppressBlank ?? true,
					suppressNst: callbacksOrOptions?.suppressNst ?? true,
				});
				logger.info('[Whisper] Native startRealtimeTranscribe succeeded');
			} catch (nativeError) {
				logger.warn('[Whisper] startRealtimeTranscribe call result:', {
					error: nativeError instanceof Error ? nativeError.message : String(nativeError),
					note: 'This may return void or throw; either way the event listener is set up',
				});
			}

			logger.info('[Whisper] Realtime transcription started with event-driven approach');
		} catch (error) {
			this.realtimeState = null;
			this.realtimeSubscriptions.forEach((s) => s.remove());
			this.realtimeSubscriptions = [];

			const errorMessage = error instanceof Error ? error.message : String(error);
			logger.error('[Whisper] Failed to start realtime transcription:', {
				error: errorMessage,
			});
			throw error;
		}
	}

	/**
	 * Stop realtime transcription and get accumulated results
	 *
	 * Stops the streaming transcription started by startRealtime() and returns all accumulated segments and text.
	 *
	 * @param options Transcription options
	 * @returns Promise resolving to transcription task with accumulated results from streaming
	 * @see startRealtime() to begin real-time streaming
	 * @see stopRecording() for batch recording alternative
	 */
	async stopRealtime(options: TranscribeOptions = {}): Promise<TranscriptionTask> {
		if (!this.contextId) {
			const error = new Error('No active context. Call initialize() first.');
			logger.error('[Whisper] Cannot stop realtime transcription:', {
				error: error.message,
			});
			throw error;
		}

		if (!this.realtimeState?.isStreaming) {
			logger.warn('[Whisper] Realtime transcription not active');
			const task = this.createTask('realtime');
			task.status = 'complete';
			task.result = {
				text: '',
				segments: [],
			};
			return task;
		}

		const task = this.createTask('realtime');
		task.status = 'processing';

		try {
			logger.info('[Whisper] Stopping realtime transcription...', {
				taskId: task.taskId,
			});

			this.realtimeSubscriptions.forEach((s) => s.remove());
			this.realtimeSubscriptions = [];

			const finalResult: TranscribeResult = {
				text: this.realtimeState?.accumulatedText || '',
				segments: this.realtimeState?.accumulatedSegments || [],
				duration: 0,
				language: 'auto',
			};

			task.status = 'complete';
			task.endTime = Date.now();
			task.progress = 100;
			task.result = finalResult;

			this.realtimeState = null;

			logger.info('[Whisper] Realtime transcription stopped', {
				taskId: task.taskId,
				textLength: finalResult.text?.length || 0,
				segmentCount: finalResult.segments?.length || 0,
				note: 'Results from accumulated events',
			});

			return task;
		} catch (error) {
			task.status = 'error';
			task.endTime = Date.now();
			task.error = error instanceof Error ? error : new Error(String(error));

			this.realtimeSubscriptions.forEach((s) => s.remove());
			this.realtimeSubscriptions = [];
			this.realtimeState = null;

			const errorMessage = task.error.message;
			logger.error('[Whisper] Error stopping realtime transcription:', {
				error: errorMessage,
			});
			throw error;
		}
	}

	/**
	 * Get realtime accumulated text
	 *
	 * @returns Currently accumulated transcribed text
	 */
	getRealtimeText(): string {
		return this.realtimeState?.accumulatedText || '';
	}

	/**
	 * Get realtime accumulated segments
	 *
	 * @returns Currently accumulated segments
	 */
	getRealtimeSegments(): Segment[] {
		return this.realtimeState?.accumulatedSegments || [];
	}

	/**
	 * Check if realtime streaming is active
	 *
	 * @returns True if actively streaming
	 */
	isRealtimeActive(): boolean {
		return this.realtimeState?.isStreaming || false;
	}

	/**
	 * Get task by ID
	 *
	 * @param taskId Task identifier
	 * @returns Task or undefined if not found
	 */
	getTask(taskId: string): TranscriptionTask | undefined {
		return this.tasks.get(taskId);
	}

	/**
	 * Get all active tasks
	 *
	 * @returns Array of active (non-complete/error) tasks
	 */
	getActiveTasks(): TranscriptionTask[] {
		return Array.from(this.tasks.values()).filter(
			(t) => t.status === 'queued' || t.status === 'processing'
		);
	}

	/**
	 * Get service statistics
	 *
	 * @returns Statistics about tasks
	 */
	getStats(): { active: number; total: number; completed: number; failed: number } {
		const tasks = Array.from(this.tasks.values());
		return {
			active: tasks.filter((t) => t.status === 'queued' || t.status === 'processing')
				.length,
			total: tasks.length,
			completed: tasks.filter((t) => t.status === 'complete').length,
			failed: tasks.filter((t) => t.status === 'error' || t.status === 'cancelled').length,
		};
	}

	/**
	 * Clean up completed tasks older than specified time
	 *
	 * @param olderThanMs Clean tasks older than this many milliseconds
	 */
	cleanupCompletedTasks(olderThanMs: number = 3600000): void {
		const now = Date.now();
		let cleaned = 0;

		for (const [taskId, task] of this.tasks.entries()) {
			if (
				(task.status === 'complete' || task.status === 'error' || task.status === 'cancelled') &&
				task.endTime &&
				now - task.endTime > olderThanMs
			) {
				this.tasks.delete(taskId);
				cleaned++;
			}
		}

		logger.info('[Whisper] Cleaned up completed tasks', { count: cleaned });
	}

	/**
	 * Clear all completed/errored tasks
	 */
	clearCompletedTasks(): void {
		let cleared = 0;

		for (const [taskId, task] of this.tasks.entries()) {
			if (task.status === 'complete' || task.status === 'error' || task.status === 'cancelled') {
				this.tasks.delete(taskId);
				cleared++;
			}
		}

		logger.info('[Whisper] Cleared completed tasks', { count: cleared });
	}

	/**
	 * Get library version
	 *
	 * @returns Version string
	 */
	async getLibVersion(): Promise<string> {
		return ExpoWhisper.getLibVersion();
	}

	/**
	 * Release resources and cleanup
	 */
	async release(): Promise<void> {
		if (this.contextId) {
			if (this.realtimeState?.isStreaming) {
				try {
					await this.stopRealtime();
				} catch (error) {
					logger.warn('[Whisper] Error stopping realtime during release:', { error });
				}
			}

			await ExpoWhisper.releaseContext(this.contextId);
			this.contextId = null;
			this.tasks.clear();
			this.tasksByJobId.clear();
			Whisper.instance = null;

			logger.info('[Whisper] Released and cleaned up');
		}
	}
}

export default Whisper;
