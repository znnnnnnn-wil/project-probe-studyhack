package com.projectprobe;

import java.util.Map;

final class ExampleReference {
  static final String FIELD = "referenceAnswer";
  static final int MAX_LENGTH = 48;
  static final String INSTRUCTIONS =
    "referenceAnswer 写成一句可直接朗读的中文口语，建议 30–40 字，最多 " + MAX_LENGTH + " 个字符（含英文和标点）。"
    + "只说关键做法和结果。题目未要求时省略框架名、异常类名和中间步骤。"
    + "结合预填项目材料回答当前问题，未验证的细节用‘我会’或‘假设’说明，不编造结果、数据或职责。"
    + "参考回答独立返回，不写进题干或面试官的发言。";

  static boolean enabled(Map<String, Object> practice) {
    return Boolean.TRUE.equals(practice.get("example"));
  }

  static String read(Object value) {
    if (!(value instanceof String text)) return "";
    String answer = text.strip();
    return answer.length() <= MAX_LENGTH ? answer : "";
  }
}
