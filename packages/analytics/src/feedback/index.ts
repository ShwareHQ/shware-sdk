import { config } from '../setup/index';
import type { CreateFeedbackDTO } from '../schema/index';

export async function sendFeedback(dto: CreateFeedbackDTO) {
  await config.http.post('/feedback', dto);
}
