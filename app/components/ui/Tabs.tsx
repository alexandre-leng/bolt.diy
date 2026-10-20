import * as TabsPrimitive from '@radix-ui/react-tabs';
import * as React from 'react';
import { classNames } from '~/utils/classNames';

/*
 * Only class names UnoCSS can generate are used here: the theme path is
 * `bolt.elements.background.depth.N`, so `bg-bolt-elements-background-depth-N` compiles and
 * `bg-bolt-elements-background` / `*-depth-0` / `*-dark` / `ring-bolt-elements-ring` do not.
 * Those ungenerated classes left the browser's own light control surface under white theme text.
 *
 * The active tab is ONE STEP ABOVE its list (`depth-2` list -> `depth-3` trigger), never the same
 * fill, so the selected state is visible by paint and not only by the text colour.
 */
const Tabs = TabsPrimitive.Root;

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={classNames(
      'inline-flex h-10 items-center justify-center rounded-md bg-bolt-elements-background-depth-2 p-1 text-bolt-elements-textSecondary border border-bolt-elements-borderColor',
      className,
    )}
    {...props}
  />
));
TabsList.displayName = TabsPrimitive.List.displayName;

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={classNames(
      'inline-flex items-center justify-center whitespace-nowrap rounded-sm bg-transparent px-3 py-1.5 text-sm font-medium text-bolt-elements-textSecondary transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bolt-elements-borderColorActive disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-bolt-elements-background-depth-3 data-[state=active]:text-bolt-elements-textPrimary data-[state=active]:shadow-sm hover:text-bolt-elements-textPrimary',
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={classNames(
      'mt-2 text-bolt-elements-textPrimary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bolt-elements-borderColorActive',
      className,
    )}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsList, TabsTrigger, TabsContent };
