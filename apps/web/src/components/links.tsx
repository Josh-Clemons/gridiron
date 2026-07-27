import CardActionArea, { type CardActionAreaProps } from '@mui/material/CardActionArea';
import Tab, { type TabProps } from '@mui/material/Tab';
import { createLink } from '@tanstack/react-router';
import { forwardRef } from 'react';

/**
 * MUI components that are also typed router links.
 *
 * `component={Link}` works at runtime but defeats MUI's overload resolution, so the
 * router's `createLink` is the supported seam: it wraps a component that renders an
 * anchor and hands back one that takes `to` and `params` with full type checking. A
 * mistyped route is a compile error rather than a dead tab.
 */
// `component` is omitted from the prop types on purpose: leaving it optional makes the
// spread widen it to `'a' | undefined`, MUI's generic overload stops matching, and the
// ref is then typed for the default element instead of an anchor.
const TabAnchor = forwardRef<HTMLAnchorElement, Omit<TabProps<'a'>, 'component'>>((props, ref) => (
  <Tab {...props} component="a" ref={ref} />
));
TabAnchor.displayName = 'TabAnchor';

export const TabLink = createLink(TabAnchor);

const CardActionAreaAnchor = forwardRef<
  HTMLAnchorElement,
  Omit<CardActionAreaProps<'a'>, 'component'>
>((props, ref) => <CardActionArea {...props} component="a" ref={ref} />);
CardActionAreaAnchor.displayName = 'CardActionAreaAnchor';

export const CardActionAreaLink = createLink(CardActionAreaAnchor);
