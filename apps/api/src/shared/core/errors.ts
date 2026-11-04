export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Não autorizado') {
    super(401, message, 'UNAUTHORIZED');
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message = 'Demasiadas tentativas') {
    super(429, message, 'TOO_MANY_REQUESTS');
  }
}

// 403 com códigos próprios para os clientes saberem que têm de pedir o segundo factor
export class MfaRequiredError extends AppError {
  constructor(message = 'Autenticação de dois factores obrigatória') {
    super(403, message, 'MFA_REQUIRED');
  }
}

export class MfaStepUpRequiredError extends AppError {
  constructor(message = 'Confirme novamente o código do autenticador') {
    super(403, message, 'MFA_STEP_UP_REQUIRED');
  }
}

export class PaymentRequiredError extends AppError {
  constructor(message = 'Pagamento necessário') {
    super(402, message, 'PAYMENT_REQUIRED');
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Acesso negado') {
    super(403, message, 'FORBIDDEN');
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Recurso não encontrado') {
    super(404, message, 'NOT_FOUND');
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflito') {
    super(409, message, 'CONFLICT');
  }
}

export class ValidationError extends AppError {
  constructor(
    message = 'Dados inválidos',
    public readonly details?: unknown,
  ) {
    super(422, message, 'VALIDATION_ERROR');
  }
}
