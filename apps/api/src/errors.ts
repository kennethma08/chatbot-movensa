export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export function notFound(message = 'Recurso no encontrado.') {
  return new AppError(404, 'NOT_FOUND', message);
}

export function forbidden(message = 'No tienes permisos para realizar esta acción.') {
  return new AppError(403, 'FORBIDDEN', message);
}

export function conflict(message: string) {
  return new AppError(409, 'CONFLICT', message);
}
