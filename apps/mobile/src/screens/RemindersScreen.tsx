import { Text } from 'react-native';
import { validateReminderTitle } from '@bigmind/domain/reminders';

import { Card } from '../components/Card';
import { Screen } from '../components/Screen';
import { colors, spacing, typography } from '../theme';

function titleIsValid(title: string): boolean {
  try {
    validateReminderTitle(title);
    return true;
  } catch {
    return false;
  }
}

const valid = titleIsValid('Review notes');
const invalid = titleIsValid('');

export function RemindersScreen() {
  return (
    <Screen title="Reminders" subtitle="Never miss a due date">
      <Card title="Coming soon">
        <Text style={styles.text}>
          Reminders will reuse the shared reminder rules from{' '}
          <Text style={styles.code}>@bigmind/domain</Text> and the same
          outbox-based sync path used by the web app.
        </Text>
        <Text style={styles.example}>
          Title validation: 'Review notes' is {String(valid)} · empty is{' '}
          {String(invalid)}
        </Text>
      </Card>
    </Screen>
  );
}

const styles = {
  text: { color: colors.textMuted, fontSize: typography.body },
  example: {
    color: colors.text,
    fontSize: typography.body,
    marginTop: spacing.sm,
  },
  code: {
    color: colors.primary,
    fontSize: typography.body,
  },
};
