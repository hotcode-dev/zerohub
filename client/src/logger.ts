/* eslint-disable */
import { LogLevel } from "./types";

export interface Logger {
  log: (message?: any, ...optionalParams: any[]) => void;
  warn: (message?: any, ...optionalParams: any[]) => void;
  error: (message?: any, ...optionalParams: any[]) => void;
}

export class ZeroHubLogger {
  logLevel: LogLevel;
  private logger: Logger;

  constructor(logger: Logger, logLevel: LogLevel) {
    this.logLevel = logLevel;
    this.logger = logger;
  }

  /**
   * Logs a message to the console if the log level is set to Debug.
   * @param message
   * @param optionalParams
   */
  log(message?: any, ...optionalParams: any[]) {
    if (this.logLevel === LogLevel.Debug) {
      this.logger.log(message, ...optionalParams);
    }
  }

  /**
   * Logs a warning message to the console if the log level is set to Debug or Warning.
   * @param message
   * @param optionalParams
   */
  warn(message?: any, ...optionalParams: any[]) {
    if (
      this.logLevel === LogLevel.Debug ||
      this.logLevel === LogLevel.Warning
    ) {
      this.logger.warn(message, ...optionalParams);
    }
  }

  /**
   * Logs an error message to the console if the log level is set to Debug, Warning, or Error.
   * @param message
   * @param optionalParams
   */
  error(message?: any, ...optionalParams: any[]) {
    if (
      this.logLevel === LogLevel.Debug ||
      this.logLevel === LogLevel.Warning ||
      this.logLevel === LogLevel.Error
    ) {
      this.logger.error(message, ...optionalParams);
    }
  }
}
