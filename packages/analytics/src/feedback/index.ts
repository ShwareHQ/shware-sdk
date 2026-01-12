import { fetch } from '@shware/utils';
import type { CreateFeedbackDTO } from '../schema/index';
import { config } from '../setup/index';

export async function sendFeedback(dto: CreateFeedbackDTO) {
  const response = await fetch(`${config.endpoint}/feedback`, {
    method: 'POST',
    credentials: 'include',
    headers: await config.getHeaders(),
    body: JSON.stringify(dto),
  });

  if (!response.ok) {
    throw new Error(`Failed to send feedback: ${response.status} ${await response.text()}`);
  }
}
