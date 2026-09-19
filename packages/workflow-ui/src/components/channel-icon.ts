import {
  Bot,
  type LucideIcon,
  Mail,
  MessageCircle,
  MessageSquareText,
  MessagesSquare,
  Send,
  Smartphone,
  Webhook,
} from 'lucide-react';
import type { MetricChannel } from '../config';

/**
 * One glyph per delivery channel, shared by the chart cards, the channel
 * pickers and the message table — a channel has to read the same everywhere or
 * the eye stops using the icon as an index.
 *
 * lucide dropped brand marks, so iOS and Android borrow the nearest generic
 * pair (a handset, a robot): what matters here is that the two platforms are
 * told apart at a glance, not that the logo is right.
 */
export const CHANNEL_ICON: Record<MetricChannel, LucideIcon> = {
  email: Mail,
  push_ios: Smartphone,
  push_android: Bot,
  slack: MessagesSquare,
  discord: MessageCircle,
  sms: MessageSquareText,
  webhook: Webhook,
};

/** Stand-in for "every channel": still a send, just not one transport. */
export const ALL_CHANNELS_ICON: LucideIcon = Send;

export const channelIcon = (channel: MetricChannel | undefined): LucideIcon =>
  channel === undefined ? ALL_CHANNELS_ICON : CHANNEL_ICON[channel];
