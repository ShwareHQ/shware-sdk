import { hasText } from '@shware/utils';
import type { DefaultNamespace, Namespace, TFunction } from 'i18next';
import { type BadRequest, DetailType, type ErrorInfo } from './detail';
import type { ResolvedErrorReason } from './reason';
import type { ErrorBody } from './status';

export function getErrorInfo(data: unknown): ErrorInfo | null {
  if (typeof data !== 'object' || data === null || !('error' in data)) return null;
  const { error } = data as ErrorBody;
  const errorInfo = error?.details?.find((d) => d['@type'] === DetailType.ERROR_INFO);
  return errorInfo ?? null;
}

/**
 * @example For axios:
 *
 * const { t } = useTranslation('error');
 *
 * const { message } = getErrorMessage(error.response.data, t);
 * toast.error(message);
 */
export function getErrorMessage<Ns extends Namespace = DefaultNamespace, KPrefix = undefined>(
  data: unknown,
  t: TFunction<Ns, KPrefix>
): { reason: ResolvedErrorReason | null; message: string } {
  // 0. unknown error
  if (typeof data !== 'object' || data === null || !('error' in data)) {
    console.error('Unknown API error:', data);
    return { reason: null, message: t('UNKNOWN') };
  }

  const { error } = data as ErrorBody;

  // 1. from server via Accept-Language header or lng param
  const localizedMessage = error?.details?.find((d) => d['@type'] === DetailType.LOCALIZED_MESSAGE);
  if (localizedMessage) return { reason: null, message: localizedMessage.message };

  // 2. from business logic error
  const errorInfo = error?.details?.find((d) => d['@type'] === DetailType.ERROR_INFO);
  if (errorInfo) {
    return {
      reason: errorInfo.reason,
      message: t(errorInfo.reason, errorInfo.metadata),
    };
  }

  // 3. error message in english
  if (hasText(error.message)) return { reason: null, message: error.message };

  // 4. from server via status code
  if (error.status) return { reason: null, message: t(error.status) };

  // 5. unknown error
  console.error('Unknown API error:', data);
  return { reason: null, message: t('UNKNOWN') };
}

/**
 * @example For react-hook-form:
 *
 * const { setError } = useForm();
 * const fieldViolations = getFieldViolations(error.response.data);
 * fieldViolations.forEach((violation) => {
 *   setError(violation.field, { message: violation.description });
 * });
 */
export function getFieldViolations(data: unknown): BadRequest['fieldViolations'] {
  if (typeof data !== 'object' || data === null || !('error' in data)) return [];
  const { error } = data as ErrorBody;
  const badRequest = error?.details?.find((d) => d['@type'] === DetailType.BAD_REQUEST);
  return badRequest?.fieldViolations ?? [];
}
