import React, { useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Button, ButtonWithLoading } from '@actual-app/components/button';
import { Paragraph } from '@actual-app/components/paragraph';
import { SpaceBetween } from '@actual-app/components/space-between';
import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import { send } from '@actual-app/core/platform/client/connection';
import { format as formatDate } from '@actual-app/core/shared/months';
import { q } from '@actual-app/core/shared/query';
import {
  discoveryKey,
  readDismissedCandidates,
} from '@actual-app/core/shared/schedule-discovery';
import type { DiscoverScheduleEntity } from '@actual-app/core/types/models';
// @ts-strict-ignore
import { useQuery } from '@tanstack/react-query';

import { Modal, ModalCloseButton, ModalHeader } from '#components/common/Modal';
import { Field, Row, SelectCell, Table, TableHeader } from '#components/table';
import { DisplayId } from '#components/util/DisplayId';
import { useDateFormat } from '#hooks/useDateFormat';
import { useLocale } from '#hooks/useLocale';
import {
  SelectedProvider,
  useSelected,
  useSelectedDispatch,
  useSelectedItems,
} from '#hooks/useSelected';
import { useSyncedPref } from '#hooks/useSyncedPref';
import { aqlQuery } from '#queries/aqlQuery';
import { getRecurringDescription } from '#util/schedule';

import { ScheduleAmountCell } from './SchedulesTable';

const ROW_HEIGHT = 66;

function DiscoverSchedulesTable({
  schedules,
  loading,
}: {
  schedules: DiscoverScheduleEntity[];
  loading: boolean;
}) {
  const { t } = useTranslation();

  const selectedItems = useSelectedItems();
  const dispatchSelected = useSelectedDispatch();
  const dateFormat = useDateFormat() || 'MM/dd/yyyy';
  const locale = useLocale();

  function renderItem({ item }: { item: DiscoverScheduleEntity }) {
    const selected = selectedItems.has(item.id);
    const amountOp = item._conditions.find(c => c.field === 'amount').op;
    const recurDescription = getRecurringDescription(
      item.date,
      dateFormat,
      locale,
    );

    return (
      <Row
        height={ROW_HEIGHT}
        inset={15}
        onClick={e => {
          dispatchSelected({
            type: 'select',
            id: item.id,
            isRangeSelect: e.shiftKey,
          });
        }}
        style={{
          borderColor: selected ? theme.tableBorderSelected : theme.tableBorder,
          cursor: 'pointer',
          color: selected
            ? theme.tableRowBackgroundHighlightText
            : theme.tableText,
          backgroundColor: selected
            ? theme.tableRowBackgroundHighlight
            : theme.tableBackground,
          ':hover': {
            backgroundColor: theme.tableRowBackgroundHover,
            color: theme.tableText,
          },
        }}
      >
        <SelectCell
          exposed
          focused={false}
          selected={selected}
          onSelect={e => {
            dispatchSelected({
              type: 'select',
              id: item.id,
              isRangeSelect: e.shiftKey,
            });
          }}
        />
        <Field
          width="flex"
          truncate={false}
          contentStyle={{ gap: 4 }}
          style={{
            flexDirection: 'column',
            alignItems: 'flex-start',
            justifyContent: 'center',
            gap: 4,
          }}
        >
          <DisplayId type="payees" id={item.payee} />
          <Text style={{ fontSize: 12, color: 'inherit' }}>
            {(typeof item.amount === 'number'
              ? item.amount
              : item.amount.num1) < 0 ? (
              <Trans>Recurring payment</Trans>
            ) : (
              <Trans>Recurring income</Trans>
            )}
          </Text>
        </Field>
        <Field width="flex">
          <DisplayId type="accounts" id={item.account} />
        </Field>
        <Field width="auto" title={recurDescription} style={{ flex: 1.5 }}>
          {recurDescription}
        </Field>
        <Field
          width="auto"
          truncate={false}
          contentStyle={{ gap: 4 }}
          style={{
            flex: 1.6,
            flexDirection: 'column',
            alignItems: 'flex-start',
            justifyContent: 'center',
            gap: 4,
          }}
        >
          {item.evidence && (
            <>
              <Text>
                {t('Based on {{count}} transactions', {
                  count: item.evidence.transactionCount,
                })}
              </Text>
              <Text style={{ fontSize: 12 }}>
                {t('Last observed {{date}}', {
                  date: formatDate(item.evidence.lastDate, dateFormat),
                })}
              </Text>
            </>
          )}
        </Field>
        <ScheduleAmountCell amount={item.amount} op={amountOp} />
      </Row>
    );
  }

  return (
    <View style={{ ...styles.tableContainer, minWidth: 900 }}>
      <TableHeader height={ROW_HEIGHT} inset={15}>
        <SelectCell
          exposed={!loading}
          focused={false}
          selected={selectedItems.size > 0}
          onSelect={e =>
            dispatchSelected({ type: 'select-all', isRangeSelect: e.shiftKey })
          }
        />
        <Field width="flex">
          <Trans>Payee</Trans>
        </Field>
        <Field width="flex">
          <Trans>Account</Trans>
        </Field>
        <Field width="auto" style={{ flex: 1.5 }}>
          <Trans>When</Trans>
        </Field>
        <Field width="auto" style={{ flex: 1.6 }}>
          <Trans>Evidence</Trans>
        </Field>
        <Field width={100} style={{ textAlign: 'right' }}>
          <Trans>Amount</Trans>
        </Field>
      </TableHeader>
      <Table
        rowHeight={ROW_HEIGHT}
        style={{
          flex: 1,
          backgroundColor: 'transparent',
        }}
        items={schedules}
        loading={loading}
        isSelected={id => selectedItems.has(String(id))}
        renderItem={renderItem}
        renderEmpty={t('No schedules found')}
      />
    </View>
  );
}

export function DiscoverSchedules() {
  const { t } = useTranslation();

  const {
    data,
    isFetching: isLoading,
    isError: discoveryError,
    refetch,
  } = useQuery({
    queryKey: ['schedules', 'discovery'],
    queryFn: () => send('schedule/discover'),
    // Preserve candidate IDs and partial-creation retries throughout this review.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    gcTime: 0,
    retry: false,
  });
  const [dismissedPref, setDismissedPref] = useSyncedPref(
    'dismissed-schedule-candidates',
  );
  const dismissed = readDismissedCandidates(dismissedPref);
  const schedules = (data || []).filter(
    schedule => !dismissed.includes(discoveryKey(schedule)),
  );
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(false);
  const createdIds = useRef(new Map<string, string>());

  const selectedInst = useSelected<DiscoverScheduleEntity>(
    'discover-schedules',
    schedules,
    [],
  );

  async function onCreate() {
    const selected = schedules.filter(s => selectedInst.items.has(s.id));
    setCreating(true);
    setError(false);
    try {
      for (const schedule of selected) {
        let scheduleId = createdIds.current.get(schedule.id);
        if (!scheduleId) {
          scheduleId = await send('schedule/create', {
            conditions: schedule._conditions,
            schedule: {},
          });
          createdIds.current.set(schedule.id, scheduleId);
        }

        // Now query for matching transactions and link them automatically
        const { filters } = await send('make-filters-from-conditions', {
          conditions: schedule._conditions,
        });

        if (filters.length > 0) {
          const { data: transactions } = await aqlQuery(
            q('transactions').filter({ $and: filters }).select('id'),
          );

          await send('transactions-batch-update', {
            updated: transactions.map(t => ({
              id: t.id,
              schedule: scheduleId,
            })),
          });
        }
      }

      return true;
    } catch {
      setError(true);
      return false;
    } finally {
      setCreating(false);
    }
  }

  function onDismiss() {
    const keys = schedules
      .filter(s => selectedInst.items.has(s.id))
      .map(discoveryKey);
    setDismissedPref(JSON.stringify([...new Set([...dismissed, ...keys])]));
    selectedInst.dispatch({ type: 'select-none' });
  }

  return (
    <Modal
      name="schedules-discover"
      containerProps={{ style: { width: 1040, maxWidth: '95vw', height: 680 } }}
    >
      {({ state }) => (
        <>
          <ModalHeader
            title={t('Review recurring activity')}
            rightContent={<ModalCloseButton onPress={() => state.close()} />}
          />
          <Paragraph>
            <Trans>
              Review possible recurring payments and income. Select the ones you
              want to track as schedules. Suggestions are not confirmed
              subscriptions.
            </Trans>
          </Paragraph>
          <Paragraph>
            <Trans>
              Suggestions use matching payees, similar amounts, and recurring
              dates. Last observed is transaction history, not proof that an
              account is up to date. Variable bills or changed payees may need a
              manual schedule.
            </Trans>
          </Paragraph>
          {discoveryError && (
            <Paragraph role="alert" style={{ color: theme.errorText }}>
              <Trans>Recurring activity could not be loaded.</Trans>{' '}
              <Button
                onPress={() => {
                  void refetch();
                }}
              >
                <Trans>Try again</Trans>
              </Button>
            </Paragraph>
          )}
          {error && (
            <Paragraph role="alert" style={{ color: theme.errorText }}>
              <Trans>
                Schedules could not be fully created. Try again to finish
                linking the selected transactions.
              </Trans>
            </Paragraph>
          )}

          <SelectedProvider instance={selectedInst}>
            <View style={{ flex: 1, overflowX: 'auto' }}>
              <DiscoverSchedulesTable
                loading={isLoading}
                schedules={schedules}
              />
            </View>
          </SelectedProvider>

          <SpaceBetween
            style={{
              paddingTop: 20,
              paddingBottom: 0,
              alignItems: 'center',
              justifyContent: 'flex-end',
              flexWrap: 'wrap',
              gap: 10,
            }}
          >
            {dismissed.length > 0 && (
              <Button
                isDisabled={creating}
                onPress={() => setDismissedPref('[]')}
              >
                <Trans>Restore dismissed</Trans>
              </Button>
            )}
            <Button
              isDisabled={creating || selectedInst.items.size === 0}
              onPress={onDismiss}
            >
              <Trans>Dismiss selected</Trans>
            </Button>
            <ButtonWithLoading
              variant="primary"
              isLoading={creating}
              isDisabled={isLoading || selectedInst.items.size === 0}
              onPress={() => {
                void onCreate().then(success => {
                  if (success) state.close();
                });
              }}
            >
              <Trans>Create schedules</Trans>
            </ButtonWithLoading>
          </SpaceBetween>
        </>
      )}
    </Modal>
  );
}
