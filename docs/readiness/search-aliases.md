# Catalogue search aliases (for review)

Source of truth: `apps/api/src/modules/creators/aliases.ts` (shared by catalogue Search and Live Discovery). Language
identifier for Roman Urdu: `roman_urdu`. A query word in any listed form matches all forms of its concept; other words
are searched as typed. A city in the text matches the creator's own declared city field or their own bio, never another
person's content. The city filter accepts any listed form.

| Concept | Forms | Origin | Status |
|---|---|---|---|
| food | food, foodie, khana, کھانا, فوڈ | Live Discovery reviewed terms (2026-10-13) | In use |
| beauty | beauty, khubsurti, خوبصورتی, بیوٹی | same | In use |
| makeup | makeup, میک اپ | same | In use |
| bridal | bridal, dulhan, دلہن, برائیڈل | same | In use |
| fashion | fashion, libaas, لباس, فیشن | same | In use |
| travel | travel, safar, سفر, ٹریول | same | In use |
| fitness | fitness, warzish, ورزش, فٹنس | same | In use |
| technology | technology, tech, ٹیکنالوجی, ٹیک | same | In use |
| Lahore | lahore, lhr, لاہور | Urdu name reviewed; LHR owner-listed | In use |
| Karachi | karachi, khi, کراچی | Urdu name reviewed; KHI common short form | In use, **confirm KHI** |
| Islamabad | islamabad, isb, اسلام آباد | Urdu name reviewed; ISB common short form | In use, **confirm ISB** |
| Rawalpindi | rawalpindi, pindi, rwp, راولپنڈی | Urdu name reviewed; Pindi/RWP common | In use, **confirm Pindi, RWP** |
| Peshawar | peshawar, پشاور | Urdu name reviewed | In use |
| Faisalabad | faisalabad, fsd, فیصل آباد | Urdu name reviewed; FSD common short form | In use, **confirm FSD** |
| Multan | multan, ملتان | Urdu name reviewed | In use |
| Quetta | quetta, کوئٹہ | Urdu name reviewed | In use |

Measured on the local 21-creator catalogue (2026-10-14, PostgreSQL, matching only, not quality): khana 1 → 10 results,
lhr 0 → 3 (same as "lahore"), کھانا 9 (same as "food"), latency 3–65 ms. Quality needs the human-labelled panel.

To add a term: add the form to the concept in `aliases.ts`, add a case to `aliases.test.ts` and
`catalog-aliases.int.test.ts`, and bump `CATALOG_RANKER_VERSION` in `cursor.ts`.
