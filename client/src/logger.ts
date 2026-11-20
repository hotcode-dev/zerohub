import { LogLevel } from "./types";

/**
 * An interface for a logger that can be used to log messages.
 *
 * This mirrors the browser `console` surface: a single optional leading
 * message plus an open list of extra parameters. Parameters are typed as
 * `unknown` (rather than `any`) so callers may pass any value — strings,
 * `Error`s, protobuf messages — without losing the file's lint coverage.
 */
export interface Logger {
  /**
   * Logs a message.
   * @param message - The message to log.
   * @param optionalParams - Optional parameters to log.
   */
  log: (message?: unknown, ...optionalParams: unknown[]) => void;
  /**
   * Logs a warning message.
   * @param message - The message to log.
   * @param optionalParams - Optional parameters to log.
   */
  warn: (message?: unknown, ...optionalParams: unknown[]) => void;
  /**
   * Logs an error message.
   * @param message - The message to log.
   * @param optionalParams - Optional parameters to log.
   */
  error: (message?: unknown, ...optionalParams: unknown[]) => void;
}

/**
 * A logger that can be used to log messages with different log levels.
 */
export class ZeroHubLogger {
  /**
   * The log level for the logger.
   */
  logLevel: LogLevel;
  private logger: Logger;

  /**
   * Creates a new ZeroHubLogger.
   * @param logger - The logger to use.
   * @param logLevel - The log level to use.
   */
  constructor(logger: Logger, logLevel: LogLevel) {
    this.logLevel = logLevel;
    this.logger = logger;
  }

  /**
   * Logs a message to the console if the log level is set to Debug.
   * @param message - The message to log.
   * @param optionalParams - Optional parameters to log.
   */
  log(message?: unknown, ...optionalParams: unknown[]) {
    if (this.logLevel === LogLevel.Debug) {
      this.logger.log(message, ...optionalParams);
    }
  }

  /**
   * Logs a warning message to the console if the log level is set to Debug or Warning.
   * @param message - The message to log.
   * @param optionalParams - Optional parameters to log.
   */
  warn(message?: unknown, ...optionalParams: unknown[]) {
    if (
      this.logLevel === LogLevel.Debug ||
      this.logLevel === LogLevel.Warning
    ) {
      this.logger.warn(message, ...optionalParams);
    }
  }

  /**
   * Logs an error message to the console if the log level is set to Debug, Warning, or Error.
   * @param message - The message to log.
   * @param optionalParams - Optional parameters to log.
   */
  error(message?: unknown, ...optionalParams: unknown[]) {
    if (
      this.logLevel === LogLevel.Debug ||
      this.logLevel === LogLevel.Warning ||
      this.logLevel === LogLevel.Error
    ) {
      this.logger.error(message, ...optionalParams);
    }
  }
}
