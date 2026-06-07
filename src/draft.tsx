import React from 'react';

// --- Design System Tokens (Simulated via Tailwind classes) ---
// In a real design system, these would map to specific CSS variables or Tailwind config values.
// For this exercise, we're using standard Tailwind classes that represent common token values.
const spacing = {
  containerPaddingX: 'px-4 sm:px-6 lg:px-8', // Responsive horizontal padding
  containerPaddingY: 'py-8 md:py-12',       // Responsive vertical padding
  gridGap: 'gap-6',                         // Gap between grid items
};

const layout = {
  maxWidth: 'max-w-screen-xl',              // Max width for the main content container
  backgroundColor: 'bg-gray-900',           // Workspace background
  cardBackgroundColor: 'bg-gray-800',       // Card background
  placeholderColor: 'bg-gray-700',          // Placeholder element color
};

// --- Helper Components for Placeholders ---

/**
 * A generic placeholder for a dashboard card or widget.
 * Simulates a loading state with pulsing elements.
 */
const DashboardCardPlaceholder: React.FC<{ className?: string; title?: string }> = ({ className, title }) => (
  <div className={`${layout.cardBackgroundColor} rounded-lg p-6 flex flex-col justify-between ${className}`}>
    <div className={`h-4 w-3/4 ${layout.placeholderColor} rounded mb-4 animate-pulse`}></div>
    <div className={`h-3 w-full ${layout.placeholderColor} rounded mb-2 animate-pulse`}></div>
    <div className={`h-3 w-5/6 ${layout.placeholderColor} rounded animate-pulse`}></div>
    {title && <span className="mt-4 text-gray-500 text-xs">{title}</span>}
  </div>
);

/**
 * A generic placeholder for a larger dashboard section, like a chart or table.
 * Simulates a loading state with pulsing elements.
 */
const DashboardSectionPlaceholder: React.FC<{ className?: string; title?: string }> = ({ className, title }) => (
  <div className={`${layout.cardBackgroundColor} rounded-lg p-6 flex flex-col ${className}`}>
    <div className={`h-6 w-1/2 ${layout.placeholderColor} rounded mb-6 animate-pulse`}></div>
    <div className={`flex-grow ${layout.placeholderColor} rounded animate-pulse`}></div>
    {title && <span className="mt-4 text-gray-500 text-xs">{title}</span>}
  </div>
);

/**
 * The main Dashboard UI component.
 * Implements a responsive 12-column grid layout with proper centering, padding, and margins.
 */
export const DashboardPlaceholders: React.FC = () => {
  return (
    // Outer "Preview Workspace" container
    // Provides the overall background and some initial padding for the workspace itself.
    <div className={`min-h-screen ${layout.backgroundColor} text-white p-4 sm:p-6 md:p-8`}>
      {/*
        Centered Grid Container Wrapper
        - `container`: Sets a max-width based on breakpoints and provides `width: 100%`.
        - `mx-auto`: Horizontally centers the container.
        - `max-w-screen-xl`: Defines the maximum width for the content area, adhering to design system tokens.
        - `px-X sm:px-Y lg:px-Z`: Responsive horizontal padding to prevent content from slamming edges.
        - `py-X md:py-Y`: Responsive vertical padding.
      */}
      <div className={`container mx-auto ${layout.maxWidth} ${spacing.containerPaddingX} ${spacing.containerPaddingY}`}>
        <h1 className="text-3xl sm:text-4xl font-bold mb-8 text-center text-gray-100">
          Design System Dashboard Preview
        </h1>

        {/*
          The 12-column responsive grid layout.
          - `grid`: Activates CSS Grid.
          - `grid-cols-1`: Default to a single column on extra small screens (mobile-first).
          - `sm:grid-cols-2`: On small screens and up, use 2 columns.
          - `lg:grid-cols-12`: On large screens and up, activate the full 12-column grid system.
          - `gap-6`: Provides consistent spacing between grid items, using a design system token for gap.
        */}
        <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 ${spacing.gridGap}`}>

          {/*
            Example Layout Sections:
            These demonstrate how different components can span columns within the 12-column grid.
            The `lg:col-span-X` classes ensure they take up the specified number of columns
            on large screens, while naturally flowing into 1 or 2 columns on smaller screens
            due to the `grid-cols-1` and `sm:grid-cols-2` definitions.
          */}

          {/* Hero Section: Spans all 12 columns on large screens */}
          <DashboardSectionPlaceholder
            className="h-64 lg:col-span-12"
            title="Main Hero Section (lg:col-span-12)"
          />

          {/* Two Overview Cards: Each spans 6 columns on large screens */}
          <DashboardCardPlaceholder
            className="h-48 lg:col-span-6"
            title="Overview Card 1 (lg:col-span-6)"
          />
          <DashboardCardPlaceholder
            className="h-48 lg:col-span-6"
            title="Overview Card 2 (lg:col-span-6)"
          />

          {/* Detailed Chart View: Spans 8 columns on large screens */}
          <DashboardSectionPlaceholder
            className="h-80 lg:col-span-8"
            title="Detailed Chart View (lg:col-span-8)"
          />

          {/* Quick Summary List: Spans 4 columns on large screens */}
          <DashboardCardPlaceholder
            className="h-80 lg:col-span-4"
            title="Quick Summary List (lg:col-span-4)"
          />

          {/* Three Metric Cards: Each spans 4 columns on large screens */}
          <DashboardCardPlaceholder
            className="h-48 lg:col-span-4"
            title="Metric Card A (lg:col-span-4)"
          />
          <DashboardCardPlaceholder
            className="h-48 lg:col-span-4"
            title="Metric Card B (lg:col-span-4)"
          />
          <DashboardCardPlaceholder
            className="h-48 lg:col-span-4"
            title="Metric Card C (lg:col-span-4)"
          />

          {/* Another full-width section */}
          <DashboardSectionPlaceholder
            className="h-64 lg:col-span-12"
            title="Footer Information / Table (lg:col-span-12)"
          />

        </div>
      </div>
    </div>
  );
};