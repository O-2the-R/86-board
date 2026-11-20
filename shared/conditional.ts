// The database's answer when a row was not in the state a change needed:
// already gone (for an update or a delete) or already there (for a create).
// It arrives as an error, but it is often what the caller wanted anyway, so
// the functions ask this before treating it as a failure.
export type GqlErrors = { message?: string; errorType?: string }[];

export const conditionFailed = (errors: GqlErrors | null | undefined): boolean =>
  (errors ?? []).some((e) => /ConditionalCheckFailed|conditional request failed/i.test(`${e.errorType ?? ''} ${e.message ?? ''}`));
