// preloaded into every suite: the clock starts at 10:00 today (local), so suites that advance their fake clock by hours never cross midnight
const RealDate = Date, d = new RealDate(); d.setHours(10, 0, 0, 0)
const offset = d.getTime() - RealDate.now()
class TestDate extends RealDate {
  constructor(...a) { if (a.length) super(...a); else super(TestDate.now()) }
  static now() { return RealDate.now() + offset }
}
globalThis.Date = TestDate
