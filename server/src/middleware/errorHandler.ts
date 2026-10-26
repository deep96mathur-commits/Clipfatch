import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';

export class AppError extends Error {
  public statusCode: number;
  public code: string;
  public details?: string;

  constructor(message: string, statusCode = 400, code = 'BAD_REQUEST', details?: string) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  // Handle Zod validation error
  if (err instanceof ZodError) {
    const issue = err.issues[0];
    return res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: issue ? `${issue.path.join('.')}: ${issue.message}` : 'Invalid request payload',
        details: err.issues.map((i) => i.message).join(', '),
      },
    });
  }

  // Handle known AppError
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
      },
    });
  }

  // Generic internal server error: hide internal error messages / stack traces
  return res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected server error occurred. Please try again later.',
    },
  });
}
