# Cookidoo fixtures

Recorded answers of the Cookidoo API, taken from the tests of
[cookidoo-api](https://github.com/miaucl/cookidoo-api) (Cyrill Raccaud, MIT
licence), the Python library the Home Assistant integration uses:

| File                                                    | From (`tests/responses.py` unless said otherwise)                                                                                                   |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shopping-list.json`                                    | `GET_SHOPPING_LIST_RECIPES`, with the `customerRecipes` of `GET_INGREDIENTS_FOR_CUSTOM_RECIPES` and the `additionalItems` of `GET_ADDITIONAL_ITEMS` |
| `additional-items-added.json`                           | `ADD_ADDITIONAL_ITEMS`                                                                                                                              |
| `additional-items-ownership.json`                       | `EDIT_ADDITIONAL_ITEMS_OWNERSHIP`                                                                                                                   |
| `ingredients-ownership.json`                            | `EDIT_INGREDIENTS_OWNERSHIP`                                                                                                                        |
| `calendar-week.json`                                    | `CALENDAR_WEEK`                                                                                                                                     |
| `calendar-week-custom.json`                             | `CALENDAR_WEEK_WITH_CUSTOM_RECIPES`                                                                                                                 |
| `custom-recipe.json`                                    | `GET_CUSTOM_RECIPE`                                                                                                                                 |
| `subscriptions-trial-active.json`                       | `ACTIVE_SUBSCRIPTION`                                                                                                                               |
| `subscriptions-ended.json`                              | `INACTIVE_SUBSCRIPTION` (also `docs/raw-api-requests/active-subscription.txt`)                                                                      |
| `subscriptions-regular-active.json`                     | the values of Home Assistant's `tests/components/cookidoo/fixtures/subscriptions.json`, in the raw API shape                                        |
| `profile.json`                                          | `USER_INFO`                                                                                                                                         |
| `oidc-discovery.json`, `token*.json`, `login-page.html` | the OAuth fixtures of the same file                                                                                                                 |
| `well-known.json`                                       | `well-known-snapshots/latest.json` (live `.well-known/home` links of cookidoo.de), one HAL document per service                                     |

Anonymized: the author ids of the plans and of the custom recipe are
replaced by a made-up UUID. No token, e-mail or password of a real account is
here.
