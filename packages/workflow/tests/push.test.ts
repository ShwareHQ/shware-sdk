import { describe, expect, test } from 'vitest';
import { fillProps, registryPushRenderer } from '../src/push';

describe('push content', () => {
  test('fillProps fills {prop} placeholders and blanks missing ones', () => {
    expect(fillProps('Hi {name}, {count} new', { name: 'Ada', count: 3 })).toBe('Hi Ada, 3 new');
    expect(fillProps('Hi { name }!', {})).toBe('Hi !');
    expect(fillProps('{{ user.name }} stays', { name: 'x' })).toBe('{{ user.name }} stays');
  });

  test('registryPushRenderer renders a registered module and rejects unknown keys', async () => {
    const render = registryPushRenderer({
      comeback: {
        title: 'We saved your spot, {name}',
        body: 'Come back',
        image: 'https://x/{name}.png',
      },
      bare: {},
    });
    expect(await render('comeback', { name: 'Ada' })).toEqual({
      title: 'We saved your spot, Ada',
      body: 'Come back',
      image: 'https://x/Ada.png',
    });
    expect(await render('bare', {})).toEqual({ title: '', body: '' });
    await expect(render('nope', {})).rejects.toThrow('unknown push template: nope');
  });
});
