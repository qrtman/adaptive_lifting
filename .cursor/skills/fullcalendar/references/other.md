# Fullcalendar - Other

**Pages:** 20

---

## Week Numbers - Docs | FullCalendar

**URL:** https://fullcalendar.io/docs/week-numbers

**Contents:**
- Docs Week Numbers
- Demo:

Display week numbers in various parts of your calendar views.

---

## TimeGrid View - Docs | FullCalendar

**URL:** https://fullcalendar.io/docs/timegrid-view

**Contents:**
- Docs TimeGrid View
- Week & Day View
- Custom Duration
- Demos:

A TimeGrid view displays one-or-more horizontal days as well as an axis of time, usually midnight to midnight, on the vertical axis. Either install via script tags or ES build system.

There are numerous other options throughout the docs that affect the display of TimeGrid view, such as the date/time display options and locale-related options.

The following example shows how to toggle between timeGridWeek and timeGridDay:

You can create TimeGrid views with arbitrary durations. The following creates a 4-day view:

**Examples:**

Example 1 (swift):
```swift
import { Calendar } from 'fullcalendar'
import timeGridPlugin from 'fullcalendar/timegrid'

const calendar = new Calendar(calendarEl, {
  plugins: [timeGridPlugin],
  initialView: 'timeGridWeek',
  headerToolbar: {
    left: 'prev,next',
    center: 'title',
    right: 'timeGridWeek,timeGridDay' // user can switch between the two
  }
})
```

Example 2 (swift):
```swift
import { Calendar } from 'fullcalendar'
import timeGridPlugin from 'fullcalendar/timegrid'

const calendar = new Calendar(calendarEl, {
  plugins: [timeGridPlugin],
  initialView: 'timeGridFourDay',
  views: {
    timeGridFourDay: {
      type: 'timeGrid',
      duration: { days: 4 }
    }
  }
})
```

---

## Date & Time Display - Docs | FullCalendar

**URL:** https://fullcalendar.io/docs/date-display

**Contents:**
- Docs Date & Time Display

Settings that control presence/absense of dates as well as their styling and text. These settings work across a variety of different views.

---

## Introduction - Docs | FullCalendar

**URL:** https://fullcalendar.io/docs/intro

**Contents:**
- Docs Introduction

How to get FullCalendar’s code, initialize a calendar, and other basic principles.

---

## Custom Views - Docs | FullCalendar

**URL:** https://fullcalendar.io/docs/custom-views

**Contents:**
- Docs Custom Views
- Demos:

It’s possible to take a pre-defined view that FullCalendar provides and create your own view that spans a different periods of time. You can even code your own view from scratch with JS.

---

## Date Navigation - Docs | FullCalendar

**URL:** https://fullcalendar.io/docs/date-navigation

**Contents:**
- Docs Date Navigation
- Demo:

Methods and settings that determine the view’s current dates.

---

## Multi-Month Stack - Docs | FullCalendar

**URL:** https://fullcalendar.io/docs/multimonth-stack

**Contents:**
- Docs Multi-Month Stack
- Without Month Headers
- Endless Scroll
- Demo:

You can create a specific type of Multi-Month Grid with a single column. The user must scroll to see months beyond the first. This is achieved by setting multiMonthMaxColumns to 1.

Either install via script tags or ES build system. Then initialize the calendar in JavaScript:

Months are separate by month headers that stick to the top of the scroll container. The text of the header is controlled by singleMonthTitleFormat.

There are numerous other options throughout the docs that affect the display of Multi-Month view, such as the date/time display options and locale-related options.

Want one continuous table of cells without month headers? See dayGridYear view »

Want endless scrolling of months that goes on forever? Follow this GitHub ticket »

**Examples:**

Example 1 (swift):
```swift
import { Calendar } from 'fullcalendar'
import multiMonthPlugin from 'fullcalendar/multimonth'

const calendar = new Calendar(calendarEl, {
  plugins: [multiMonthPlugin],
  initialView: 'multiMonthYear',
  multiMonthMaxColumns: 1 // force a single column
});
```

---

## Theme - Docs | FullCalendar

**URL:** https://fullcalendar.io/docs/theming

**Contents:**
- Docs Theme

It is possible to change the look of the calendar (colors, fonts, etc)

---

## Now Indicator - Docs | FullCalendar

**URL:** https://fullcalendar.io/docs/now-indicator

**Contents:**
- Docs Now Indicator
- Demos:

You can display a marker that represents the exact current time in both TimeGrid view and Timeline view.

---

## DayGrid View - Docs | FullCalendar

**URL:** https://fullcalendar.io/docs/daygrid-view

**Contents:**
- Docs DayGrid View
- Week & Day View
- Month View
- Year View
- Custom Duration
- Demos:

A DayGrid view displays one or more cells, each representing a day.

There are numerous other options throughout the docs that affect the display of DayGrid view, such as the date/time display options and locale-related options.

The following example shows how to toggle between dayGridWeek and dayGridDay:

The dayGridMonth view is the most common. View docs specifically for month view »

The dayGridYear view shows one continuous grid of cells for an entire year. The user most scroll. The first cell of each month is emphasized, as controlled by monthStartFormat.

dayGridYear view was added in v6.1.0.

You can create DayGrid views with arbitrary durations. The following creates a 4-week view:

**Examples:**

Example 1 (swift):
```swift
import { Calendar } from 'fullcalendar'
import dayGridPlugin from 'fullcalendar/daygrid'

const calendar = new Calendar(calendarEl, {
  plugins: [dayGridPlugin],
  initialView: 'dayGridWeek',
  headerToolbar: {
    left: 'prev,next',
    center: 'title',
    right: 'dayGridWeek,dayGridDay' // user can switch between the two
  }
})
```

Example 2 (swift):
```swift
import { Calendar } from 'fullcalendar'
import dayGridPlugin from 'fullcalendar/daygrid'

const calendar = new Calendar(calendarEl, {
  plugins: [dayGridPlugin],
  initialView: 'dayGridYear'
})
```

Example 3 (swift):
```swift
import { Calendar } from 'fullcalendar'
import dayGridPlugin from 'fullcalendar/daygrid'

const calendar = new Calendar(calendarEl, {
  plugins: [dayGridPlugin],
  initialView: 'dayGridFourWeek',
  views: {
    dayGridFourWeek: {
      type: 'dayGrid',
      duration: { weeks: 4 }
    }
  }
})
```

---

## Date Clicking & Selecting - Docs | FullCalendar

**URL:** https://fullcalendar.io/docs/date-clicking-selecting

**Contents:**
- Docs Date Clicking & Selecting
- Demos:

Detect when the user clicks on dates or times. Give the user the ability to select multiple dates or time slots with their mouse or touch device.

---

## Month View - Docs | FullCalendar

**URL:** https://fullcalendar.io/docs/month-view

**Contents:**
- Docs Month View
- Demo:

The Month view is a specific type of DayGrid view called dayGridMonth. Either install via script tags or ES build system. Then initialize the calendar in JavaScript:

There are numerous other options throughout the docs that affect the display of DayGrid view, such as the date/time display options and locale-related options.

**Examples:**

Example 1 (swift):
```swift
import { Calendar } from 'fullcalendar'
import dayGridPlugin from 'fullcalendar/daygrid'

const calendar = new Calendar(calendarEl, {
  plugins: [dayGridPlugin],
  initialView: 'dayGridMonth'
});
```

---

## Toolbar - Docs | FullCalendar

**URL:** https://fullcalendar.io/docs/toolbar

**Contents:**
- Docs Toolbar
- Demo:

The area at the top and bottom of the calendar that contains buttons and other controls.

---

## Premium Plugins - Docs | FullCalendar

**URL:** https://fullcalendar.io/docs/premium

**Contents:**
- Docs Premium Plugins
- Free Trial
- Demos:

FullCalendar Premium (also known as “FullCalendar Scheduler”) is a collection of plugins released under a different license than the standard plugins. Each plugin offers additional functionality:

A Premium plugin is initialized in the same way a typical standard plugin would be initialized:

FullCalendar Premium can be downloaded and evaluated for an unlimited amount of time, free of charge. This evaluation version is licensed under a Creative Commons license that does not allow distribution of source code modifications nor use in commercial production websites or products.

During your free trial, in order to hide the license warning, use the following license key:

**Examples:**

Example 1 (gdscript):
```gdscript
var calendar = new Calendar(calendarEl, {
  schedulerLicenseKey: 'CC-Attribution-NonCommercial-NoDerivatives'
});
```

---

## Timeline View - Docs | FullCalendar

**URL:** https://fullcalendar.io/docs/timeline-view

**Contents:**
- Docs Timeline View
- Demos:

FullCalendar Premium provides a view called “timeline view” with a customizable horizontal time-axis and resources as rows.

The following pre-configured timeline views are available: timelineDay, timelineWeek, timelineMonth, and timelineYear. They can be initialized in an ES6 setup like so:

(Or a packages like @fullcalendar/react-scheduler for React, Vue, and Angular)

Or, you can choose to initialize Timeline view with the fullcalendar-scheduler global bundle:

If you need a different duration, make a custom view with type 'resourceTimeline':

When creating a custom-duration view, reasonable defaults for the slot-related settings will automatically be chosen.

The following options are specific to Timeline view. However, there are numerous other options throughout the docs that affect the display of Timeline view, such as the locale-related options, date/time display options, and resource display options.

**Examples:**

Example 1 (unknown):
```unknown
npm install --save fullcalendar-scheduler
```

Example 2 (lua):
```lua
import { Calendar } from 'fullcalendar';
import resourceTimelinePlugin from 'fullcalendar-scheduler/resource-timeline';
...
let calendar = new Calendar(calendarEl, {
  plugins: [ resourceTimelinePlugin ],
  initialView: 'resourceTimeline',
  resources: [
    // your resource list
  ]
});
...
```

Example 3 (html):
```html
<script src='<fullcalendar-dist>/all/global.js'></script>
<script src='<fullcalendar-scheduler-dist>/all/global.js'></script>
<script src='<fullcalendar-dist>/themes/monarch/global.js'></script>
<link href='<fullcalendar-dist>/skeleton.css' rel='stylesheet' />
<link href='<fullcalendar-dist>/themes/monarch/theme.css' rel='stylesheet' />
<link href='<fullcalendar-dist>/themes/monarch/palettes/purple.css' rel='stylesheet' />
<script>
...
var calendar = new FullCalendar.Calendar(calendarEl, {
  initialView: 'resourceTimelineWeek',
  resources: [
    // your resource list
  ]
});
...
</script>
```

Example 4 (gdscript):
```gdscript
var calendar = new Calendar(calendarEl, {
  initialView: 'resourceTimelineFourDays',
  views: {
    resourceTimelineFourDays: {
      type: 'resourceTimeline',
      duration: { days: 4 }
    }
  }
});
```

---

## V7 Changelog - Docs | FullCalendar

**URL:** https://fullcalendar.io/docs/upgrading-from-v6

**Contents:**
- V7 Changelog
- Table of Contents
- React
- Preact
- Vue
- Angular
- Vanilla JS
- Web Component
- Standard Themes
  - Classic Theme

This major release introduces a formal theme system, 4 new standard themes, plays well with Tailwind, simplifies the DOM structure, improves performance, accessibility, responsiveness, and print-view. In total, (AT LEAST) 57 tickets were resolved.

This guide assumes you’re upgrading from v6. To upgrade from v5, first follow the v5 → v6 guide and then return to this guide. The two upgrade guides can be stacked with no issue.

Want the code? Read the instructions

Want the full docs in a non-changelog format? View the docs

Found a bug? Report it on the issue tracker

Shadcn and MUI theme systems are also newly available for React. See below.

View each UI frameworks’ docs for installation instruction.

There is a “Classic” theme that maintains the look of the old calendar. Changes from v6:

See the DayGrid View section for subcomponents of the All-Day section.

Updates to the @fullcalendar/icalendar plugin:

The temporal-polyfill package is now a peer dependency of all the FullCalendar packages. This means you are required to install it.

The “Temporal” built-in browser API is coming to all modern browsers, and this package is a polyfill for it, which means it allows you to use it before it’s officially supported.

FullCalendar DOES NOT INSTALL IT GLOBALLY but instead uses it internally. For v7, FullCalendar uses the tree-shakeable API, meaning the code-size impact will be minimal and there will be no side-effects.

Though FullCalendar does not install the polyfill globally, you are welcome to do so for your projects:

While the STANDARD FullCalendar packages have been, and always will be, licensed under the permissive MIT license, the PREMIUM packages have more complex licensing:

In v7, AGPLv3 is replacing GPLv3 as the copyleft license used for open-source projects. If your project’s frontend and backend are open-source and AGPLv3-compliant, use the following license key:

We’ve discovered a few instances of for-profit companies using FullCalendar Premium in closed-source projects, claiming to be GPLv3-compliant via the SaaS loophole. By switching to AGPLv3, we are closing this loophole and forcing such companies to either purchase a commercial license or stay on v6.

If you are the author of a GPL’d SaaS project that uses FullCalendar Premium and are concerned that you cannot upgrade to v7 due to the license change, please consider the benefits of switching to AGPLv3 yourself.

**Examples:**

Example 1 (unknown):
```unknown
import 'temporal-polyfill/global'
```

Example 2 (yaml):
```yaml
schedulerLicenseKey: 'AGPL-My-Frontend-And-Backend-Are-Open-Source'
```

---

## Multi-Month Grid - Docs | FullCalendar

**URL:** https://fullcalendar.io/docs/multimonth-grid

**Contents:**
- Docs Multi-Month Grid
- Year as a Grid
- Year as a Stack
- Custom Duration
- Demo:

The Multi-Month view displays multiple individual months. Either install via script tags or ES build system.

There are numerous other options throughout the docs that affect the display of Multi-Month view, such as the date/time display options and locale-related options.

The multiMonthYear view displays a 3x4 grid of months. However, if space does not allow, it will responsively shift to 2x6 or even 1x12. The singleMonthMinWidth setting ultimately determines the number of columns. Example:

The multiMonthYear view can be configured as a single column (aka “stack”). View docs specifically for Multi-Month Stack »

You can create Multi-Month views with arbitrary durations. The following creates a 4-month view:

**Examples:**

Example 1 (swift):
```swift
import { Calendar } from 'fullcalendar'
import multiMonthPlugin from 'fullcalendar/multimonth'

let calendar = new Calendar(calendarEl, {
  plugins: [multiMonthPlugin],
  initialView: 'multiMonthYear'
})
```

Example 2 (swift):
```swift
import { Calendar } from 'fullcalendar'
import multiMonthPlugin from 'fullcalendar/multimonth'

const calendar = new Calendar(calendarEl, {
  plugins: [multiMonthPlugin],
  initialView: 'multiMonthFourMonth',
  views: {
    multiMonthFourMonth: {
      type: 'multiMonth',
      duration: { months: 4 }
    }
  }
})
```

---

## List View - Docs | FullCalendar

**URL:** https://fullcalendar.io/docs/list-view

**Contents:**
- Docs List View
- Event Appearance
- Toolbar Buttons
- Demo:

A list view displays events in a simple vertical list for a specific interval of time. If there are no events during a specific interval of time, the “No events to display” screen is displayed, which can be customized via render hooks. There are 4 preset list views: listDay, listWeek, listMonth, and listYear. They can be initialized in an ES6 setup like so:

Or you can choose to initialized the List views as a global bundle:

If you’d like a different interval of time, you can create a custom view with type 'list'.

The following settings are specific to list-view. However, many other settings throughout the API also affect list-view as well, such as in the event render hooks and eventClick.

The event appearance can be controlled by List Item Event Render Hooks.

In the following example, we pass non-standard information about events through the extendedProps hash property. Then, we change the display of the event row and dot marker depending on a custom status property:

By default, the Toolbar will render buttons for list-view as the text “List”. To opt-out of this behavior, and render duration-based buttons like “Week” or “Month”, set listText: false.

**Examples:**

Example 1 (lua):
```lua
import { Calendar } from 'fullcalendar';
import listPlugin from 'fullcalendar/list';
...
let calendar = new Calendar(calendarEl, {
  plugins: [ listPlugin ],
  initialView: 'listWeek'
});
...
```

Example 2 (html):
```html
<script src='<fullcalendar-dist>/all/global.js'></script>
<script src='<fullcalendar-dist>/themes/monarch/global.js'></script>
<link href='<fullcalendar-dist>/skeleton.css' rel='stylesheet' />
<link href='<fullcalendar-dist>/themes/monarch/theme.css' rel='stylesheet' />
<link href='<fullcalendar-dist>/themes/monarch/palettes/purple.css' rel='stylesheet' />
<script>
...
var calendar = new FullCalendar.Calendar(calendarEl, {
  initialView: 'listWeek'
});
...
</script>
```

Example 3 (json):
```json
var calendar = new FullCalendar.Calendar(calendarEl, {
  initialView: 'listWeek',
  events: [
    {
      title: 'Meeting',
      start: '2019-08-12T14:30:00',
      extendedProps: {
        status: 'done'
      }
    },
    {
      title: 'Birthday Party',
      start: '2019-08-13T07:00:00',
      color: 'green'
    }
  ],
  listItemEventClass: (data) => (
    data.event.extendedProps.status === 'done'
      ? 'list-item-event-done'
      : ''
  ),
  listItemEventBeforeClass: (data) => (
    data.event.extendedProps.status === 'done'
      ? 'list-item-event-dot-done'
      : '',
  ),
});
```

Example 4 (css):
```css
/* CSS */

.list-item-event-done {
  background-color: red;
}

.list-item-event-dot-done {
  background-color: white;
}
```

---

## Date Nav Links - Docs | FullCalendar

**URL:** https://fullcalendar.io/docs/date-nav-links

**Contents:**
- Docs Date Nav Links
- Demo:

Turns various datetime text into clickable links that the user can use for navigation. Activated by setting the navLinks settings to true.

---

## Vertical Resource View - Docs | FullCalendar

**URL:** https://fullcalendar.io/docs/vertical-resource-view

**Contents:**
- Docs Vertical Resource View
- Demos:

FullCalendar Premium provides TimeGrid view and DayGrid view with the ability to display resources as columns. For example, a TimeGrid day resource view can be initialized in an ES6 setup like so:

(Or a packages like @fullcalendar/react-scheduler for React, Vue, and Angular)

Or, you can choose to initialize it with the fullcalendar-scheduler global bundle:

DayGrid requires a similar setup »

The following options are specific to Vertical Resource view. However, there are numerous other options throughout the docs that affect the display of Vertical Resource view, such as the locale-related options, date/time display options, and resource display options.

**Examples:**

Example 1 (unknown):
```unknown
npm install --save fullcalendar-scheduler
```

Example 2 (lua):
```lua
import { Calendar } from 'fullcalendar';
import resourceTimeGridPlugin from 'fullcalendar-scheduler/resource-timegrid';
...
let calendar = new Calendar(calendarEl, {
  plugins: [ resourceTimeGridPlugin ],
  initialView: 'resourceTimeGridDay',
  resources: [
    // your list of resources
  ]
});
...
```

Example 3 (html):
```html
<script src='<fullcalendar-dist>/all/global.js'></script>
<script src='<fullcalendar-scheduler-dist>/all/global.js'></script>
<script src='<fullcalendar-dist>/themes/monarch/global.js'></script>
<link href='<fullcalendar-dist>/skeleton.css' rel='stylesheet' />
<link href='<fullcalendar-dist>/themes/monarch/theme.css' rel='stylesheet' />
<link href='<fullcalendar-dist>/themes/monarch/palettes/purple.css' rel='stylesheet' />
<script>
...
var calendar = new FullCalendar.Calendar(calendarEl, {
  initialView: 'resourceTimeGridDay',
  resources: [
    // your list of resources
  ]
});
...
</script>
```

---
