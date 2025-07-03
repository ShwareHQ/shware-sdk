import type { CreateFeedbackDTO } from '../schema/index';
import { config } from '../setup/index';

export async function sendFeedback(dto: CreateFeedbackDTO) {
  await config.http.post('/feedback', dto);
}
