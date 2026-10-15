# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- Sign-in to a Cookidoo account (e-mail, password, country and language of the
  account), with the tokens kept in the integration's data and renewed
  automatically.
- A **Cookidoo** device: items to buy and checked, the shopping list as a text,
  the recipes planned today with their count and total time, the subscription
  type, end date and days left.
- Refresh every 5 minutes by default (2 to 30), by the integration itself, only
  while the device is added or a widget is shown.
- Scene actions: add an item to the shopping list, check or uncheck an item by
  its name, clear the checked items.
- Dashboard widgets: the shopping list with buttons to add, check, uncheck and
  clear, and the recipe of the day with its picture and a link to Cookidoo
  (Gladys 5.2.0 or later).
- A **Test the connection** button in the Configuration screen.
- Documentation in English, French, German and Spanish.

[Unreleased]: https://github.com/guim31/gladys-cookidoo/commits/main
