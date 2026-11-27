/**
 * 随机任务库：36 条，id 固定，方便排除已看过的。
 *
 * 单独抽成模块，是因为 main.ts 和 reset.ts 都要用它：
 * 重置数据时必须把系统任务重新灌回模板池，否则抽一次少一条。
 */
export interface SystemTaskTemplate {
  id: string;
  title: string;
  description: string;
  reward: number;
}

export const SYSTEM_TASKS: SystemTaskTemplate[] = [
  { id: 'sys-01', title: '给 TA 发一段走心语音', description: '录一段不少于 60 秒的语音，说说想念、感谢或最近的感受。', reward: 1 },
  { id: 'sys-02', title: '具体地夸一次 TA', description: '写下 TA 的三个优点，每个优点配上一个真实的小事例。', reward: 1 },
  { id: 'sys-03', title: '为 TA 制作一份歌单', description: '挑选五首适合 TA 或代表你们关系的歌，并写一句推荐语。', reward: 1 },
  { id: 'sys-04', title: '记录 TA 的喜好', description: '整理一份不少于十条的喜好清单，例如口味、颜色、习惯和偏好。', reward: 1 },
  { id: 'sys-05', title: '写一封短短的情书', description: '独立完成一段不少于 200 字的真诚表达，形式不限。', reward: 2 },
  { id: 'sys-06', title: '整理九张纪念照片', description: '挑选九张有意义的照片，按时间或主题排序，并为每张写一句话。', reward: 2 },
  { id: 'sys-07', title: '制作一张电子心意卡', description: '用图片、文字和一句祝福制作一张专属卡片并送给 TA。', reward: 2 },
  { id: 'sys-08', title: '准备一份快乐急救清单', description: '根据 TA 的喜好，写下五件 TA 低落时可能让心情变好的小事。', reward: 1 },
  { id: 'sys-09', title: '写一张手写小卡片', description: '亲手写下一段想对 TA 说的话，拍照保存或找机会送给 TA。', reward: 1 },
  { id: 'sys-10', title: '准备一个零预算惊喜', description: '根据 TA 最近提到的心愿，独立完成一件不需要花钱的小惊喜。', reward: 2 },
  { id: 'sys-11', title: '设计一份约会方案', description: '独立规划一次约会，包含时间、地点、活动安排和备用方案。', reward: 2 },
  { id: 'sys-12', title: '为 TA 准备一杯饮品', description: '根据 TA 的口味，亲手准备一杯温水、茶、咖啡或其他饮品。', reward: 1 },
  { id: 'sys-13', title: '为 TA 准备一份早餐', description: '独立准备一份简单早餐，尽量兼顾 TA 的口味和营养。', reward: 3 },
  { id: 'sys-14', title: '学做一道 TA 喜欢的菜', description: '从备料到完成独立制作一道菜，并记录最后的成果。', reward: 3 },
  { id: 'sys-15', title: '整理一个生活角落', description: '独立整理书桌、床头、玄关或衣柜的一处，让空间更整洁。', reward: 2 },
  { id: 'sys-16', title: '主动完成一件家务', description: '独立完成一件平时容易拖延的家务，不等别人提醒。', reward: 2 },
  { id: 'sys-17', title: '为 TA 准备好明日物品', description: '根据 TA 第二天的安排，提前准备好一件可能需要的物品。', reward: 1 },
  { id: 'sys-18', title: '制作我们的时间线', description: '整理至少五个值得纪念的时间节点，并写下对应的小事。', reward: 2 },
  { id: 'sys-19', title: '写下十件未来小事', description: '独立列出十件以后想和 TA 一起完成的小事，尽量具体、可实现。', reward: 1 },
  { id: 'sys-20', title: '给未来的 TA 留段语音', description: '录一段两分钟左右的语音，约定一个未来的日期再回听。', reward: 1 },
  { id: 'sys-21', title: '了解一个 TA 的兴趣', description: '主动学习一个 TA 感兴趣的话题，并整理三条自己真正记住的内容。', reward: 1 },
  { id: 'sys-22', title: '读一篇想分享的文章', description: '安静读完一篇文章，摘录一段喜欢的话，并写下想分享的理由。', reward: 2 },
  { id: 'sys-23', title: '独立完成一次散步', description: '散步二十分钟，拍下三处想分享给 TA 的风景或有趣细节。', reward: 2 },
  { id: 'sys-24', title: '完成一次轻量运动', description: '独立运动二十分钟，形式自选，以自身状态舒适、安全为准。', reward: 2 },
  { id: 'sys-25', title: '解决一件拖延小事', description: '独立完成一件已经拖延、会给生活带来困扰的小事。', reward: 2 },
  { id: 'sys-26', title: '写一份温柔复盘', description: '回想最近一次不愉快，写下自己可以改进的一点，不归咎对方。', reward: 2 },
  { id: 'sys-27', title: '为 TA 写一段专属祝福', description: '针对 TA 最近正在经历的事情，写一段具体、不敷衍的鼓励。', reward: 1 },
  { id: 'sys-28', title: '制作一份回忆盲盒', description: '准备三张照片、三段文字或三件小事物，组成一份回忆合集。', reward: 3 },
  { id: 'sys-29', title: '独自完成一个小作品', description: '画一幅画、做一件手工或写一首短诗，把 TA 或共同回忆作为主题。', reward: 3 },
  { id: 'sys-30', title: '给自己一次认真照顾', description: '独立做一件能让自己恢复状态的事，并记录完成后的感受。', reward: 1 },
  { id: 'sys-31', title: '认真倾听十分钟', description: '听 TA 分享最近的事情，不随意打断，也不急着评价或给建议。', reward: 2 },
  { id: 'sys-32', title: '给 TA 一个认真拥抱', description: '在双方都愿意的前提下，给 TA 一个不敷衍的拥抱。', reward: 1 },
  { id: 'sys-33', title: '为 TA 拍一组照片', description: '帮 TA 拍三张照片，耐心调整角度，最后由 TA 选出一张最喜欢的。', reward: 1 },
  { id: 'sys-34', title: '陪 TA 完成一件小事', description: '陪 TA 做一件已经在计划中的小事，期间不玩手机、不催促。', reward: 2 },
  { id: 'sys-35', title: '和 TA 看一部短片', description: '看完一部双方都能接受的短片，并各自分享一句观后感。', reward: 2 },
  { id: 'sys-36', title: '邀请 TA 散步十分钟', description: '一起慢走十分钟，主动开启一个轻松、不涉及争执的话题。', reward: 1 },
];
