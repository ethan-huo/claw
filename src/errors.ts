export type ExitCode = 1 | 2 | 3 | 4;

export type CliErrorCode =
  | "runtime_error"
  | "usage_error"
  | "not_found"
  | "forbidden"
  | "internal_error";

type CliErrorOptions = {
  cause?: unknown;
  code?: CliErrorCode;
  hint?: string;
  details?: unknown;
};

export type ErrorPayload = {
  error: {
    code: CliErrorCode;
    exit_code: number;
    message: string;
    hint?: string;
    details?: unknown;
  };
};

export class CliError extends Error {
  readonly exitCode: ExitCode;
  readonly code: CliErrorCode;
  readonly hint?: string;
  readonly details?: unknown;

  constructor(message: string, exitCode: ExitCode = 1, options?: CliErrorOptions) {
    super(message, options);
    this.name = "CliError";
    this.exitCode = exitCode;
    this.code = options?.code ?? "runtime_error";
    this.hint = options?.hint;
    this.details = options?.details;
  }
}

export function usageError(message: string, options?: Omit<CliErrorOptions, "code">): CliError {
  return new CliError(message, 2, { ...options, code: "usage_error" });
}

export function notFoundError(message: string, options?: Omit<CliErrorOptions, "code">): CliError {
  return new CliError(message, 3, { ...options, code: "not_found" });
}

export function getExitCode(error: unknown): number {
  if (error instanceof CliError) {
    return error.exitCode;
  }

  return 1;
}

export function toErrorPayload(error: unknown): ErrorPayload {
  if (error instanceof CliError) {
    return {
      error: {
        code: error.code,
        exit_code: error.exitCode,
        message: error.message,
        ...(error.hint ? { hint: error.hint } : {}),
        ...(error.details !== undefined ? { details: error.details } : {}),
      },
    };
  }

  if (error instanceof Error) {
    return {
      error: {
        code: "internal_error",
        exit_code: 1,
        message: error.message || String(error),
        details: { name: error.name },
      },
    };
  }

  return {
    error: {
      code: "internal_error",
      exit_code: 1,
      message: String(error),
    },
  };
}
