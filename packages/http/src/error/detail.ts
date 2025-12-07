/** reference: https://github.com/googleapis/googleapis/blob/master/google/rpc/error_details.proto */
import type { ErrorReason } from './reason';

export enum DetailType {
  ERROR_INFO = 'type.googleapis.com/google.rpc.ErrorInfo',
  RETRY_INFO = 'type.googleapis.com/google.rpc.RetryInfo',
  DEBUG_INFO = 'type.googleapis.com/google.rpc.DebugInfo',
  QUOTA_FAILURE = 'type.googleapis.com/google.rpc.QuotaFailure',
  PRECONDITION_FAILURE = 'type.googleapis.com/google.rpc.PreconditionFailure',
  BAD_REQUEST = 'type.googleapis.com/google.rpc.BadRequest',
  REQUEST_INFO = 'type.googleapis.com/google.rpc.RequestInfo',
  RESOURCE_INFO = 'type.googleapis.com/google.rpc.ResourceInfo',
  HELP = 'type.googleapis.com/google.rpc.Help',
  LOCALIZED_MESSAGE = 'type.googleapis.com/google.rpc.LocalizedMessage',
}

export interface ErrorInfo {
  '@type': DetailType.ERROR_INFO;
  reason: keyof ErrorReason | (string & {});
  domain?: string;
  metadata?: Record<string, string>;
}

export interface RetryInfo {
  '@type': DetailType.RETRY_INFO;
  retryDelay: number;
}

export interface DebugInfo {
  '@type': DetailType.DEBUG_INFO;
  stackEntries: string[];
  detail: string;
}

export interface QuotaFailure {
  '@type': DetailType.QUOTA_FAILURE;
  violations: {
    subject: string;
    description: string;
    apiService: string;
    quoteId: string;
    quoteValue: number;
    quotaMetric: string;
    quotaDimensions: Record<string, string>;
    futureQuotaValue: number;
  }[];
}

export interface PreconditionFailure {
  '@type': DetailType.PRECONDITION_FAILURE;
  violations: { type: string; subject: string; description: string }[];
}

export interface BadRequest {
  '@type': DetailType.BAD_REQUEST;
  fieldViolations: {
    field: string;
    description: string;
    reason: string;
    localizedMessage: Omit<LocalizedMessage, '@type'>;
  }[];
}

export interface RequestInfo {
  '@type': DetailType.REQUEST_INFO;
  requestId: string;
  servingData: string;
}

export interface ResourceInfo {
  '@type': DetailType.RESOURCE_INFO;
  resourceType: string;
  resourceName: string;
  owner: string;
  description: string;
}

export interface Help {
  '@type': DetailType.HELP;
  links: { url: string; description: string }[];
}

export interface LocalizedMessage {
  '@type': DetailType.LOCALIZED_MESSAGE;
  locale: string;
  message: string;
}

export type Detail =
  | RetryInfo
  | DebugInfo
  | QuotaFailure
  | ErrorInfo
  | PreconditionFailure
  | BadRequest
  | RequestInfo
  | ResourceInfo
  | Help
  | LocalizedMessage;

/**
 * Example usage:
 * const details = Details.new()
 *   .requestInfo({ requestId: '1234567890', servingData: '/v1/tests' })
 *   .errorInfo({ reason: 'ACCOUNT_LOCKED' });
 * */
export class Details {
  readonly list: Detail[] = [];
  private constructor() {}

  static new() {
    return new Details();
  }

  errorInfo(detail: Omit<ErrorInfo, '@type'>) {
    this.list.push({ '@type': DetailType.ERROR_INFO, ...detail });
    return this;
  }

  retryInfo(detail: Omit<RetryInfo, '@type'>) {
    this.list.push({ '@type': DetailType.RETRY_INFO, ...detail });
    return this;
  }

  debugInfo(detail: Omit<DebugInfo, '@type'>) {
    this.list.push({ '@type': DetailType.DEBUG_INFO, ...detail });
    return this;
  }

  quotaFailure(detail: Omit<QuotaFailure, '@type'>) {
    this.list.push({ '@type': DetailType.QUOTA_FAILURE, ...detail });
    return this;
  }

  preconditionFailure(detail: Omit<PreconditionFailure, '@type'>) {
    this.list.push({ '@type': DetailType.PRECONDITION_FAILURE, ...detail });
    return this;
  }

  badRequest(detail: Omit<BadRequest, '@type'>) {
    this.list.push({ '@type': DetailType.BAD_REQUEST, ...detail });
    return this;
  }

  requestInfo(detail: Omit<RequestInfo, '@type'>) {
    this.list.push({ '@type': DetailType.REQUEST_INFO, ...detail });
    return this;
  }

  resourceInfo(detail: Omit<ResourceInfo, '@type'>) {
    this.list.push({ '@type': DetailType.RESOURCE_INFO, ...detail });
    return this;
  }

  help(detail: Omit<Help, '@type'>) {
    this.list.push({ '@type': DetailType.HELP, ...detail });
    return this;
  }

  localizedMessage(detail: Omit<LocalizedMessage, '@type'>) {
    this.list.push({ '@type': DetailType.LOCALIZED_MESSAGE, ...detail });
    return this;
  }
}
