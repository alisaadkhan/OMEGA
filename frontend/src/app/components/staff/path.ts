/** Staff portal pathname (owner, 22 Nov): staff sign in only at /_omega_, never from the customer site. */
export const STAFF_PATH = "/_omega_";
export const isStaffPath = (pathname: string) => pathname === STAFF_PATH || pathname.startsWith(`${STAFF_PATH}/`);
