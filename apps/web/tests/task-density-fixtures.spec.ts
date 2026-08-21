import { expect, test } from '@playwright/test';
import { dashboardDensityTasks } from '../src/pages/dashboard/fixtures';
import { plannerDensityTasks } from '../src/pages/planner/fixtures';
import { denseTaskFixtures } from '../src/pages/tasks/fixtures';
import { taskDensitySeeds, taskDensityWeekDates } from '../src/taskDensityFixtures';

test('the canonical dense week reaches every ordinary-task fixture surface', () => {
  expect(taskDensitySeeds).toHaveLength(105);
  expect(new Set(taskDensitySeeds.map((task) => task.id).values()).size).toBe(105);
  expect(dashboardDensityTasks.map((task) => task.id)).toEqual(taskDensitySeeds.map((task) => task.id));
  expect(plannerDensityTasks.map((task) => task.id)).toEqual(taskDensitySeeds.map((task) => task.id));
  expect(denseTaskFixtures.map((task) => task.id)).toEqual(taskDensitySeeds.map((task) => task.id));

  for (const { date } of taskDensityWeekDates) {
    expect(taskDensitySeeds.filter((task) => task.date === date), date).toHaveLength(15);
    expect(dashboardDensityTasks.filter((task) => task.scheduledDate === date), `Dashboard ${date}`).toHaveLength(15);
    expect(plannerDensityTasks.filter((task) => task.scheduledDate === date), `Planner ${date}`).toHaveLength(15);
    expect(denseTaskFixtures.filter((task) => task.scheduledDate === date), `Tasks ${date}`).toHaveLength(15);
  }
});
