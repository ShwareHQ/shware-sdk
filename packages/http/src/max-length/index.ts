// noinspection UnnecessaryLocalVariableJS,JSUnusedGlobalSymbols

/**
 * A Universally Unique Identifier (UUID) is a 36-character alphanumeric string that's typically represented in the following format:
 * - Format: 8-4-4-4-12
 * */
export const UUID = 36;

/**
 * The length of an Apple device's unique device identifier (UDID) depends on the model of the device:
 * - iPhone X and earlier: The UDID is a 40-character alphanumeric string
 * - iPhone XS and later: The UDID is a 24-character string with a dash after the 8th digit
 * */
export const UDID = 40;

/**
 * Apple's Identifier for Vendors (IDFV).
 * - `var identifierForVendor: UUID? { get }` An alphanumeric string that uniquely identifies a device to the app’s vendor.
 * - Reference: [identifierForVendor](https://developer.apple.com/documentation/uikit/uidevice/1620059-identifierforvendor)
 *  */
export const IDFV = UUID;

/**
 * Apple's Identifier for Advertisers (IDFA).
 * - `var advertisingIdentifier: UUID { get }` The UUID that is specific to a device.
 * - Reference: [advertisingIdentifier](https://developer.apple.com/documentation/adsupport/asidentifiermanager/advertisingidentifier)
 * */
export const IDFA = UUID;

/**
 * Android Device ID
 * - 64-bit number (expressed as a hexadecimal string)
 * - Reference: [ANDROID_ID](https://developer.android.com/reference/android/provider/Settings.Secure.html#ANDROID_ID)
 * */
export const ANDROID_ID = 16;

/**
 * - Web Device ID: UUID v4
 * - iOS Device ID: IDFV
 * - Android Device ID: ANDROID_ID
 * */
export const DEVICE_ID = Math.max(UUID, IDFV, ANDROID_ID); // 36

/**
 * - The advertising ID is represented using version 3 of the universally unique identifier (UUID) format or an equivalent 128-bit format.
 * - If this permission is not declared, the returned value will be 00000000-0000-0000-0000-000000000000 starting early 2022.
 * - Reference: [AD_ID](https://developers.google.com/android/reference/com/google/android/gms/ads/identifier/AdvertisingIdClient.Info#public-string-getid)
 * */
export const AAID = UUID;

/**
 * - Web: UUID
 * - iOS: IDFA
 * - Android: AAID
 * */
export const ADVERTISING_ID = Math.max(UUID, IDFA, AAID); // 36

/**
 * - An IPv4 address is at most 4 sets of 3 numbers (12 characters), each set separated by a dot (.). That makes 15 characters.
 * - An IPv6 address, at its longest, would be 8 sets of 4 characters (32 total), each set separated by a colon. That makes 39 characters.
 * */
export const IPv4 = 15;
export const IPv6 = 39;
export const IPv4_MAPPED_IPv6 = 45;
export const IP = Math.max(IPv4, IPv6, IPv4_MAPPED_IPv6); // 45

/**
 * - The longest string in the database is America/Argentina/ComodRivadavia. It's 32 characters long.
 * - The mysql.time_zone_name table has a Name column defined with 64 characters.
 * - It makes sense to use VARCHAR(64) for storing this information.
 * - Reference: [List of tz database time zones](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones)
 * */
export const TIMEZONE_LONGEST = 'America/Argentina/ComodRivadavia'.length;
export const TIMEZONE = Math.max(64, TIMEZONE_LONGEST); // 64

/**
 * Reference: [List of ISO 3166 country codes](https://en.wikipedia.org/wiki/List_of_ISO_3166_country_codes)
 * */
export const COUNTRY_CODE_ALPHA_2 = 2; // US
export const COUNTRY_CODE_ALPHA_3 = 3; // USA
export const COUNTRY_CODE = Math.max(COUNTRY_CODE_ALPHA_2, COUNTRY_CODE_ALPHA_3); // 3

/**
 * Reference: [RFC5646 Tags for Identifying Languages](https://www.rfc-editor.org/rfc/rfc5646#section-4.4.1)
 * The following illustration shows how the 35-character recommendation was derived:
 * ```
 * language      =  8 ; longest allowed registered value
 *                    ;   longer than primary+extlang
 *                    ;   which requires 7 characters
 * script        =  5 ; if not suppressed: see Section 4.1
 * region        =  4 ; UN M.49 numeric region code
 *                    ;   ISO 3166-1 codes require 3
 * variant1      =  9 ; needs 'language' as a prefix
 * variant2      =  9 ; very rare, as it needs
 *                    ;   'language-variant1' as a prefix
 *
 * total         = 35 characters
 * ```
 * */
export const LANGUAGE_CODE = 35;

/**
 * Mailbox = Local-part "@" ( Domain / address-literal )
 * - Local-part:  The maximum total length of a user name or other local-part is 64 octets.
 * - Domain: The maximum total length of a domain name or number is 255 octets.
 * - Maximum length of an email address: 64 + 1 + 255 = 320
 * - Reference: [Simple Mail Transfer Protocol - Size Limits and Minimums](https://datatracker.ietf.org/doc/html/rfc5321#section-4.5.3.1)
 * */
export const EMAIL_LOCAL_PART = 64;
export const EMAIL_DOMAIN = 255;
export const EMAIL = EMAIL_LOCAL_PART + 1 + EMAIL_DOMAIN; // 320

/**
 * Reference: [E.164](https://en.wikipedia.org/wiki/E.164)
 * */
export const PHONE_NUMBER = 15;

/**
 * Reference: [How big can a user agent string get?](https://stackoverflow.com/questions/654921/how-big-can-a-user-agent-string-get)
 * */
// export const USER_AGENT = 250;
