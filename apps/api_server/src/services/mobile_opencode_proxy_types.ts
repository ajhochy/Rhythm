export interface MobileOpenCodeOperation {
  operationId: string;
  method: string;
  path: string;
  allowed: boolean;
  reason?: string;
}
