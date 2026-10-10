export function accountErrorLogDetails(input: { requestId: string; actionId: string | undefined; statusCode: number; validation: boolean }) {
  return { requestId: input.requestId, actionId: input.actionId, statusCode: input.statusCode, category: input.validation ? "ACCOUNT_VALIDATION_FAILURE" : "ACCOUNT_REQUEST_FAILURE" } as const;
}
