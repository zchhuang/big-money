import * as React from 'react';
import type { SVGProps } from 'react';
export const SvgLogo = (props: SVGProps<SVGSVGElement>) => (
  <svg
    {...props}
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 32 32"
  >
    <path fill="currentColor" d="M6 4h5v10L22 4h6L15 16l13 12h-7L11 18v10H6z" />
  </svg>
);
