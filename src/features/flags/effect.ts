import type { FlagConfig } from './queries'

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`

const matchingUsers = (rules: number) =>
  rules === 1 ? 'users who match its rule' : rules === 2 ? 'users who match both rules' : `users who match all ${rules} rules`

/**
 * Who gets the flag, in the order an SDK decides it: the kill switch, then the deny list, then the
 * allow list, then the rules, then the rollout. A null config means the flag is not set up here.
 */
export function describeEffect(config: FlagConfig | null, envName: string): string {
  if (!config) {
    return `Not set up in ${envName}. SDKs don't receive it.`
  }
  if (!config.enabled) {
    return `Off for everyone in ${envName}.`
  }

  const allowed = config.enabledUsers.length
  const denied = config.disabledUsers.length
  const rules = config.rules.filter((rule) => rule.enabled).length
  const percent = config.rolloutPercentage

  if (percent === 0 && allowed === 0) {
    return 'On, but at 0% nobody gets it.'
  }

  let sentence: string
  if (percent === 0) {
    sentence = `On, but at 0% only ${plural(allowed, 'allowed user')} ${allowed === 1 ? 'gets' : 'get'} it.`
  } else if (rules === 0 && percent === 100) {
    // Allowed users are part of everyone, so they need no mention.
    sentence = `On for everyone in ${envName}.`
  } else {
    // Everyone not on either list: those who match the rules, then the rollout's share of them.
    const audience = rules === 0 ? `${percent}% of users` : `${percent === 100 ? '' : `${percent}% of `}${matchingUsers(rules)}`
    sentence = allowed > 0 ? `On for ${plural(allowed, 'allowed user')}, and for ${audience}.` : `On for ${audience}.`
  }

  return denied > 0 ? `${sentence} ${plural(denied, 'user')} never ${denied === 1 ? 'gets' : 'get'} it.` : sentence
}
