import { DetailType } from './detail';
import { hasText } from '../utils/string';
import type { ErrorBody } from './status';
import type { DefaultNamespace, Namespace, TFunction } from 'i18next';

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
): { reason: string; message: string } {
  // 0. unknown error
  if (typeof data !== 'object' || data === null || !('error' in data)) {
    console.error('Unknown API error:', data);
    return { reason: 'UNKNOWN', message: t('UNKNOWN') };
  }

  const { error } = data as ErrorBody;

  // 1. from server via Accept-Language header or lng param
  const localizedMessage = error.details.find((d) => d.type === DetailType.LOCALIZED_MESSAGE);
  if (localizedMessage) return { reason: 'LOCALIZED_MESSAGE', message: localizedMessage.message };

  // 2. from business logic error
  const errorInfo = error.details.find((d) => d.type === DetailType.ERROR_INFO);
  if (errorInfo) {
    return {
      reason: errorInfo.reason,
      message: t(errorInfo.reason, errorInfo.metadata),
    };
  }

  // 3. error message in english
  if (hasText(error.message)) return { reason: 'ERROR_MESSAGE', message: error.message };

  // 4. from server via status code
  if (error.status) return { reason: error.status, message: t(error.status) };

  // 5. unknown error
  console.error('Unknown API error:', data);
  return { reason: 'UNKNOWN', message: t('UNKNOWN') };
}
