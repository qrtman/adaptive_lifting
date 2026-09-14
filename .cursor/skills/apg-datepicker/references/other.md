# Apg-Datepicker - Other

**Pages:** 1

---

## Date Picker Dialog Example | APG | WAI | W3C

**URL:** https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/examples/datepicker-dialog/

**Contents:**
- Date Picker Dialog Example
- Read This First
- About This Example
- Example
- February 2020
- Accessibility Features
- Keyboard Support
  - Choose Date Button
  - Date Picker Dialog
  - Date Picker Dialog: Month/Year Buttons

This is an illustrative example of one way of using ARIA that conforms with the ARIA specification.

The example below includes a date input field and a button that opens a date picker that implements the Dialog (Modal) Pattern. The dialog contains a calendar that uses the grid pattern to present buttons that enable the user to choose a day from the calendar. Choosing a date from the calendar closes the dialog and populates the date input field. When the dialog is opened, if the input field is empty, or does not contain a valid date, then the current date is focused in the calendar. Otherwise, the focus is placed on the day in the calendar that matches the value of the date input field.

Similar examples include:

Note: Since the names of the days of the week in the column headers are abbreviated to two characters, they may be difficult to understand when announced by a screen reader. An alternative column header name can be provided to screen readers by applying the abbr attribute to the th elements. So, each th element includes a abbr attribute containing the full spelling of the name of the day for that column.

To copy the following HTML code, please open it in CodePen.

---
