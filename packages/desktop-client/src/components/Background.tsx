import React from 'react';

import { theme } from '@actual-app/components/theme';

export function Background() {
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        backgroundColor: theme.pageBackground,
      }}
    />
  );
}
